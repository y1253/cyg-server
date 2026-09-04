import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PolishReplyDto } from './dto/polish-reply.dto.js';

// Minimal shape of the OpenAI Chat Completions response we consume.
interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

// Minimal shape of the OpenAI Audio Transcriptions response we consume.
interface TranscriptionResponse {
  text?: string;
  error?: { message?: string };
}

/**
 * Per-call budgets.
 *
 * Mirrors `TIMEOUTS` in `signalwire.service.ts`, and exists because this service had
 * NONE: a hung OpenAI socket held the request forever, which for the summary worker
 * would mean a cron tick that never returns and a sweep that never runs again.
 *
 * Transcription gets far longer than chat because it uploads audio and OpenAI decodes
 * the whole file before answering — a 20-minute call is not a 30-second request.
 */
const TIMEOUTS = {
  chat: 60_000,
  transcribe: 300_000,
} as const;

@Injectable()
export class AiService {
  private readonly chatUrl = 'https://api.openai.com/v1/chat/completions';
  private readonly transcribeUrl =
    'https://api.openai.com/v1/audio/transcriptions';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('OPENAI_API_KEY');
    // Budget-friendly default; override with OPENAI_POLISH_MODEL in .env.
    this.model = config.get<string>('OPENAI_POLISH_MODEL') ?? 'gpt-4o-mini';
  }

  async polishReply(dto: PolishReplyDto): Promise<{ polished: string }> {
    const isEmail = dto.kind === 'email';
    const medium = isEmail ? 'email' : 'chat message';

    const system =
      'You polish a draft reply to make it more professional, clear and ' +
      'well-written while preserving the original meaning, intent, facts and ' +
      "figures. Do not invent new information or answer on the sender's behalf " +
      'beyond what the draft says. Use tone appropriate to the medium (formal ' +
      'for email, concise and friendly for chat). Return ONLY the polished ' +
      'reply text — no preamble, quotes, subject line, or explanation.';

    const user =
      `This is the ${medium} conversation for context:\n` +
      `"""\n${dto.context}\n"""\n\n` +
      `This is my draft reply:\n"""\n${dto.draft}\n"""\n\n` +
      `Polish my draft reply for this ${medium}.`;

    const polished = await this.chat({
      model: this.model,
      system,
      user,
      maxTokens: 800,
      failure: 'The AI service failed to polish the reply.',
    });
    return { polished };
  }

  /**
   * Turn a call recording into text.
   *
   * NO `language` hint is sent, deliberately: a Montreal firm's calls are French,
   * English or a mix of both inside one sentence, and pinning a language makes the
   * mixed case worse rather than better. Detection is the model's job.
   *
   * `mimeType` and a filename with a matching extension are both sent because OpenAI
   * sniffs the format from the upload, and an extensionless part has been rejected as
   * an unsupported format even when the bytes were a valid mp3.
   */
  async transcribeAudio(
    audio: Buffer,
    filename: string,
    mimeType = 'audio/mpeg',
  ): Promise<string> {
    const form = new FormData();
    // Node 22 has global FormData/Blob, so this needs no dependency. `openai` and
    // `form-data` are both deliberately absent — every outbound integration here
    // (this service, SignalWire, Luxand) is raw fetch.
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      filename,
    );
    form.append('model', this.transcribeModelId);
    form.append('response_format', 'json');

    let res: Response;
    try {
      res = await fetch(this.transcribeUrl, {
        method: 'POST',
        // No Content-Type header: fetch must set it itself so the multipart
        // boundary matches the body it generates.
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUTS.transcribe),
      });
    } catch {
      throw new BadGatewayException('Could not reach the AI service.');
    }

    const data = (await res.json().catch(() => ({}))) as TranscriptionResponse;
    if (!res.ok) {
      // Surface OpenAI's message but never the API key.
      throw new BadGatewayException(
        data.error?.message ?? 'The AI service failed to transcribe the audio.',
      );
    }

    // An empty transcript is NOT an error: a recording can genuinely be silence, and
    // the caller decides that is a SKIPPED summary rather than a retryable failure.
    return (data.text ?? '').trim();
  }

  /**
   * A short English summary of one call transcript.
   *
   * English regardless of what was spoken, so the inbox reads consistently for staff
   * who do not share the caller's language. Anchored on the four things somebody
   * scanning a call list actually needs: who wanted what, what was agreed, what is
   * outstanding, and who owes it.
   */
  async summarizeCall(transcript: string, model: string): Promise<string> {
    const system =
      'You summarise transcripts of business phone calls at a bookkeeping and ' +
      'accountancy firm. Write 2 to 4 sentences covering: why the caller called, ' +
      'what was decided, and any follow-up owed and by whom. ' +
      'ALWAYS write in English, even when the call was conducted in another ' +
      'language. State only what the transcript supports — never guess at names, ' +
      'amounts, dates or outcomes that were not said. Transcription is imperfect; ' +
      'if the transcript is too garbled or too short to be meaningful, say exactly ' +
      'that in one sentence instead of inventing content. Return ONLY the summary ' +
      'text — no preamble, heading, bullet points or quotes.';

    const user = `Call transcript:\n"""\n${transcript}\n"""\n\nSummarise this call.`;

    return this.chat({
      model,
      system,
      user,
      maxTokens: 300,
      failure: 'The AI service failed to summarise the call.',
    });
  }

  private get transcribeModelId(): string {
    // Read at call time rather than in the constructor so the worker's config and this
    // stay one value; see `transcribeModel()` in phone.config.ts for the default.
    const raw = (process.env.OPENAI_TRANSCRIBE_MODEL ?? '').trim();
    return raw !== '' ? raw : 'whisper-1';
  }

  /** The shared Chat Completions round-trip — one place for the timeout and errors. */
  private async chat(input: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    failure: string;
  }): Promise<string> {
    let res: Response;
    try {
      res = await fetch(this.chatUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          temperature: 0.4,
          max_tokens: input.maxTokens,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUTS.chat),
      });
    } catch {
      throw new BadGatewayException('Could not reach the AI service.');
    }

    const data = (await res.json().catch(() => ({}))) as ChatCompletionResponse;

    if (!res.ok) {
      // Surface OpenAI's message but never the API key.
      throw new BadGatewayException(data.error?.message ?? input.failure);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new BadGatewayException('The AI service returned an empty reply.');
    }
    return content;
  }
}
