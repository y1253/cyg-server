import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { visionModel } from './ai.config.js';
import { documentKind } from './document-kind.util.js';

/** How much of a text file is worth sending. Past this it is a data dump, not a letter. */
const MAX_TEXT_CHARS = 20_000;

/**
 * Bytes in, plain-English summary out — with no idea which channel they came from.
 *
 * ── WHY THE CHANNEL KNOWLEDGE STAYS OUT ───────────────────────────────────────
 * There are five different ways to get an attachment's bytes here (Gmail, Graph,
 * WhatsApp's disk copy, internal messages' disk copy, and the SignalWire MMS proxy), each
 * with its own authorization. Each channel's own route proves ownership the way it
 * already knows how and hands the bytes here; this decides nothing about who may read
 * what. That is the same split `CallSummary` makes by riding on the two existing
 * recordings routes rather than adding a third guard to keep in step.
 */
@Injectable()
export class AiDocumentService {
  constructor(private readonly ai: AiService) {}

  async summarize(input: {
    bytes: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<{ summary: string }> {
    const decided = documentKind(input.mimeType, input.filename);
    if ('refuse' in decided) throw new BadRequestException(decided.refuse);

    const model = visionModel(process.env);
    const parts = this.partsFor(decided.kind, input);
    const summary = await this.ai.summarizeDocument(parts, model);
    return { summary };
  }

  /**
   * The Chat Completions content array for this kind of file.
   *
   * Text is inlined because it needs no decoder and inlining is far cheaper than a file
   * part. A PDF and an image both go to the model as-is, which is what gives a text PDF,
   * a SCANNED PDF and a photo of the same page one code path — the reason this reads
   * everything through the model rather than extracting text locally and then needing a
   * second, weaker "was the extraction any good?" rule.
   */
  private partsFor(
    kind: 'text' | 'pdf' | 'image',
    input: { bytes: Buffer; mimeType: string; filename: string },
  ): unknown[] {
    const ask = `Summarise this document: ${input.filename}`;

    if (kind === 'text') {
      const text = input.bytes.toString('utf8').slice(0, MAX_TEXT_CHARS);
      return [{ type: 'text', text: `${ask}\n\n"""\n${text}\n"""` }];
    }

    const dataUrl = `data:${input.mimeType};base64,${input.bytes.toString('base64')}`;

    if (kind === 'image') {
      return [
        { type: 'text', text: ask },
        { type: 'image_url', image_url: { url: dataUrl } },
      ];
    }

    return [
      { type: 'text', text: ask },
      {
        type: 'file',
        file: { filename: input.filename, file_data: dataUrl },
      },
    ];
  }
}
