import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';

/**
 * Short-lived proof that the bearer was already allowed to see one recording.
 *
 * ── WHY NOT JUST CHECK THE COMPANY ON THE STREAM ROUTE ─────────────────────────
 * The stream route is an `<audio src>`, so it carries a token in the query string and
 * no company in its path. Re-deriving ownership there would mean two SignalWire calls
 * (recording → call → is this our number?) on EVERY request — and a media element
 * issues a fresh Range request for every seek, so scrubbing a recording would cost
 * dozens of them.
 *
 * Instead the check happens once, where it is cheap and natural: listing a call's
 * recordings already proves the call is on that company's number. That list hands back
 * a token bound to the specific recording sid, and the stream route only has to verify
 * the binding. A token for one recording cannot fetch another, and it expires.
 *
 * Without this the stream route would accept any valid session token for any recording
 * sid on the whole SignalWire account — the sids are uuids and not published anywhere,
 * but "hard to guess" is not an access control.
 */

/** An hour: long enough to listen to a call, short enough that a leaked URL dies. */
const TTL_SECONDS = 3600;

export function signRecordingToken(sid: string): string {
  return jwt.sign({ rec: sid }, process.env.JWT_SECRET ?? 'secret', {
    expiresIn: TTL_SECONDS,
  });
}

/** Throws unless `token` was minted by us FOR THIS recording and is still valid. */
export function assertRecordingToken(
  token: string | undefined,
  sid: string,
): void {
  let payload: { rec?: unknown };
  try {
    payload = jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret') as {
      rec?: unknown;
    };
  } catch {
    throw new UnauthorizedException();
  }
  // The binding is the whole point: a valid token for recording A must not stream B.
  if (payload.rec !== sid) throw new UnauthorizedException();
}
