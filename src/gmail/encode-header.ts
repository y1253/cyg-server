/**
 * RFC 2047 / RFC 2231 encoding for outgoing MIME headers.
 *
 * Email headers are ASCII-only (RFC 5322). Writing a non-ASCII value (a Hebrew
 * subject, say) straight into a header ships raw 8-bit UTF-8 with no charset
 * declaration, so the receiving client guesses — typically Latin-1 — and the text
 * arrives as mojibake ("חנוכת" → "Ã—Â—Ã—Â ..."). Non-ASCII header values must be
 * sent as RFC 2047 encoded-words, which is what Gmail's own client emits.
 */

const isAscii = (s: string): boolean => {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s);
};

/**
 * Max UTF-8 bytes per encoded-word payload.
 *
 * An encoded-word must be <= 75 chars (RFC 2047 §2). Overhead is "=?UTF-8?B?"
 * (10) + "?=" (2) = 12. 42 bytes base64-encodes to ceil(42/3)*4 = 56 chars, so a
 * word is 68 — and even the first folded line ("Subject: " + word = 77) stays
 * inside the 78-char line guidance. 42 is a multiple of 3, so no padding is wasted.
 */
const MAX_WORD_BYTES = 42;

/**
 * Encodes a header value for safe transport.
 *
 * Pure-ASCII values are returned as-is (no need to encode, and it keeps English
 * subjects readable on the wire). Anything else becomes one or more RFC 2047
 * base64 encoded-words folded with CRLF+space.
 *
 * Chunking walks code points (`for...of`), never raw bytes, so a multi-byte
 * character — Hebrew, or an emoji's surrogate pair — is never split across two
 * encoded-words (which would corrupt it).
 */
export function encodeHeaderWord(value: string): string {
  // Strip CR/LF: they would fold the header and let a crafted value inject
  // arbitrary headers.
  const clean = (value ?? '').replace(/[\r\n]+/g, ' ');
  if (clean === '') return '';
  if (isAscii(clean)) return clean;

  const words: string[] = [];
  let chunk = '';
  const push = () => {
    if (chunk !== '') {
      words.push(
        `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`,
      );
    }
  };

  for (const ch of clean) {
    const next = chunk + ch;
    if (Buffer.byteLength(next, 'utf8') > MAX_WORD_BYTES) {
      push();
      chunk = ch;
    } else {
      chunk = next;
    }
  }
  push();

  return words.join('\r\n ');
}

/**
 * Builds the filename parameters for an attachment part.
 *
 * RFC 2047 encoded-words are not valid inside MIME parameters, so a non-ASCII
 * filename uses RFC 2231's `filename*=UTF-8''<percent-encoded>` alongside an
 * ASCII `filename="..."` fallback for clients that ignore `filename*`. This is
 * what Gmail emits. The fallback keeps the original extension so the file still
 * opens with the right application.
 */
export function attachmentNameParams(filename: string): {
  asciiName: string;
  filenameParam: string;
} {
  // Quotes/backslashes/CRLF would break out of the quoted-string parameter.
  const clean = (filename || 'attachment').replace(/["\r\n\\]/g, '_');

  if (isAscii(clean)) {
    return { asciiName: clean, filenameParam: '' };
  }

  const ext = /(\.[A-Za-z0-9]{1,8})$/.exec(clean)?.[1] ?? '';
  return {
    asciiName: `attachment${ext}`,
    filenameParam: `; filename*=UTF-8''${encodeURIComponent(clean)}`,
  };
}
