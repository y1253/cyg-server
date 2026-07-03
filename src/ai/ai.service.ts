import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PolishReplyDto } from './dto/polish-reply.dto.js';

// Minimal shape of the OpenAI Chat Completions response we consume.
interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

@Injectable()
export class AiService {
  private readonly apiUrl = 'https://api.openai.com/v1/chat/completions';
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

    let res: Response;
    try {
      res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          max_tokens: 800,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch {
      throw new BadGatewayException('Could not reach the AI service.');
    }

    const data = (await res.json().catch(() => ({}))) as ChatCompletionResponse;

    if (!res.ok) {
      // Surface OpenAI's message but never the API key.
      throw new BadGatewayException(
        data.error?.message ?? 'The AI service failed to polish the reply.',
      );
    }

    const polished = data.choices?.[0]?.message?.content?.trim();
    if (!polished) {
      throw new BadGatewayException('The AI service returned an empty reply.');
    }

    return { polished };
  }
}
