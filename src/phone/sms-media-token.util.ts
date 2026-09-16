import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';

/**
 * Short-lived proof that the bearer was already allowed to see one MMS attachment.
 *
 * ── WHY A COPY OF `recording-token.util.ts` AND NOT A SHARED HELPER ────────────
 * The shape is the same — mint where ownership is proven, verify a binding on the stream
 * route — but what each token ATTESTS TO is different, and that is the whole content of
 * both files. A recording token says "this call is on that company's number"; this one says
 * "this message is in that company's thread". Merging them would produce one function whose
 * docblock could no longer state what it proves, and a future widening of either check
 * would silently widen the other.
 *
 * The reason a token is needed at all is the same, though: the stream route is an
 * `<img src>`, so it carries its credential in the query string and has no company in its
 * path. Re-deriving ownership there would mean listing the company's messages on every
 * request — and a browser issues one per image.
 *
 * Bound to BOTH sids. A valid token for one attachment must not fetch another, including
 * another attachment on the same message: the client is handed one token per file, and
 * nothing about `Media/{sid}` is guessable-but-harmless.
 */

/** An hour, matching the recording token: long enough to read a thread, short enough that
 * a URL pasted into a chat dies. */
const TTL_SECONDS = 3600;

export function signSmsMediaToken(
  messageSid: string,
  mediaSid: string,
): string {
  return jwt.sign(
    { msg: messageSid, med: mediaSid },
    process.env.JWT_SECRET ?? 'secret',
    { expiresIn: TTL_SECONDS },
  );
}

/** Throws unless `token` was minted by us FOR THIS attachment and is still valid. */
export function assertSmsMediaToken(
  token: string | undefined,
  messageSid: string,
  mediaSid: string,
): void {
  let payload: { msg?: unknown; med?: unknown };
  try {
    payload = jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret') as {
      msg?: unknown;
      med?: unknown;
    };
  } catch {
    throw new UnauthorizedException();
  }
  if (payload.msg !== messageSid || payload.med !== mediaSid) {
    throw new UnauthorizedException();
  }
}
