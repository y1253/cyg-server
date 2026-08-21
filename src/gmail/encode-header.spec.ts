import { encodeHeaderWord } from './encode-header';

const HEBREW = 'חנוכת הבית';
const LONG_HEBREW =
  'חנוכת הבית פנר ערשטע שוהל נון מקווה נין נייסלנד און נאך א ביסל טעקסט דא';

/** Decodes "=?UTF-8?B?..?=" words (folded with CRLF+space) back to a string. */
function decodeWords(encoded: string): string {
  const words = encoded.split('\r\n ');
  return words
    .map((w) => {
      const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(w);
      if (!m) return w;
      return Buffer.from(m[1], 'base64').toString('utf8');
    })
    .join('');
}

describe('encodeHeaderWord', () => {
  it('leaves a pure-ASCII value untouched', () => {
    expect(encodeHeaderWord('Fwd: Monthly invoice')).toBe(
      'Fwd: Monthly invoice',
    );
  });

  it('returns empty string for empty/nullish input', () => {
    expect(encodeHeaderWord('')).toBe('');
    expect(encodeHeaderWord(undefined as unknown as string)).toBe('');
  });

  it('strips CR/LF so a crafted value cannot inject headers', () => {
    const injected = 'Hello\r\nBcc: attacker@evil.com';
    const out = encodeHeaderWord(injected);
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toBe('Hello Bcc: attacker@evil.com');
  });

  it('encodes Hebrew as an RFC 2047 word that round-trips', () => {
    const out = encodeHeaderWord(HEBREW);
    expect(out).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(decodeWords(out)).toBe(HEBREW);
  });

  it('encodes a real forwarded subject and round-trips it', () => {
    const subject = `Fwd: ${HEBREW}`;
    expect(decodeWords(encodeHeaderWord(subject))).toBe(subject);
  });

  it('splits a long value into multiple words that each stay within 75 chars', () => {
    const out = encodeHeaderWord(LONG_HEBREW);
    const words = out.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(decodeWords(out)).toBe(LONG_HEBREW);
  });

  it('keeps the first header line within the 78-char guidance', () => {
    const firstWord = encodeHeaderWord(LONG_HEBREW).split('\r\n ')[0];
    expect(`Subject: ${firstWord}`.length).toBeLessThanOrEqual(78);
  });

  it('never splits a multi-byte character across words', () => {
    // Emoji are surrogate pairs in JS — a byte-wise chunker would corrupt them.
    const emoji = '📎'.repeat(40);
    expect(decodeWords(encodeHeaderWord(emoji))).toBe(emoji);
  });

  it('round-trips a value that mixes ASCII and Hebrew', () => {
    const mixed = `Invoice #123 — ${HEBREW} — Q3`;
    expect(decodeWords(encodeHeaderWord(mixed))).toBe(mixed);
  });
});
