import type { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { POLISH_KINDS, type PolishKind } from './dto/polish-reply.dto';

const config = {
  getOrThrow: () => 'sk-test',
  get: () => undefined,
} as unknown as ConfigService;

interface Sent {
  system: string;
  user: string;
}

/** Captures the prompt that would have gone to OpenAI and replies with a canned answer. */
function mockFetch(content = 'polished!'): Sent[] {
  const sent: Sent[] = [];
  global.fetch = jest.fn((_url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as {
      messages: { role: string; content: string }[];
    };
    sent.push({
      system: body.messages.find((m) => m.role === 'system')?.content ?? '',
      user: body.messages.find((m) => m.role === 'user')?.content ?? '',
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    });
  }) as unknown as typeof fetch;
  return sent;
}

const draft = { draft: 'call me back', context: 'Customer: hello' };

describe('polishReply — the medium', () => {
  it('names every channel, with no channel falling through to another', async () => {
    // POLISH_MEDIUM is a Record<PolishKind, string> precisely so that adding a kind
    // without naming it is a compile error rather than a text quietly polished as an
    // email. This is the runtime half: every kind produces its OWN word.
    const seen = new Set<string>();
    for (const kind of POLISH_KINDS) {
      const sent = mockFetch();
      await new AiService(config).polishReply({ kind, ...draft });
      const m = /Polish my draft reply for this ([^.]+)\./.exec(sent[0].user);
      expect(m).not.toBeNull();
      seen.add(m![1]);
    }
    expect(seen.size).toBe(POLISH_KINDS.length);
  });

  it('calls a text a text message, not a chat message', async () => {
    const sent = mockFetch();
    await new AiService(config).polishReply({ kind: 'sms', ...draft });
    expect(sent[0].user).toContain('text message');
    expect(sent[0].user).not.toContain('chat message');
  });
});

describe('polishReply — the length limit', () => {
  it('asks for a shorter reply when maxChars is given', async () => {
    const sent = mockFetch();
    await new AiService(config).polishReply({
      kind: 'sms',
      maxChars: 160,
      ...draft,
    });
    expect(sent[0].user).toContain('under 160 characters');
    // It must ask for tighter WORDING, not for less content — a polish that silently
    // drops the question the draft was asking is worse than a two-segment text.
    expect(sent[0].user).toContain('rather than');
  });

  it('says nothing about length when it is not asked for', async () => {
    // The toggle is a CHOICE. Unticked, the prompt must be exactly what it always was,
    // so an email or a chat reply is never quietly shortened.
    const sent = mockFetch();
    await new AiService(config).polishReply({ kind: 'email', ...draft });
    expect(sent[0].user).not.toContain('characters');
  });

  it('NEVER truncates the model reply to fit', async () => {
    // ⚠️ The limit is a sentence in the prompt, not a cut. Truncating lands mid-word,
    // and the client re-checks the length anyway — see `maxChars` on the DTO.
    const long = 'x'.repeat(500);
    mockFetch(long);
    const out = await new AiService(config).polishReply({
      kind: 'sms',
      maxChars: 160,
      ...draft,
    });
    expect(out.polished).toBe(long);
    expect(out.polished.length).toBe(500);
  });
});

describe('polishReply — what did not change', () => {
  it('still sends the context and the draft verbatim', async () => {
    const sent = mockFetch();
    await new AiService(config).polishReply({
      kind: 'whatsapp' as PolishKind,
      draft: 'ok will do',
      context: 'Customer: can you send the invoice?',
    });
    expect(sent[0].user).toContain('Customer: can you send the invoice?');
    expect(sent[0].user).toContain('ok will do');
  });

  it('still forbids a preamble, so the reply can be pasted straight in', async () => {
    const sent = mockFetch();
    await new AiService(config).polishReply({ kind: 'chat', ...draft });
    expect(sent[0].system).toContain('ONLY the polished reply text');
  });
});
