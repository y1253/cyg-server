import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';

/**
 * Proof that a hold-music URL was minted by us, for SignalWire to fetch.
 *
 * ── WHY NOT THE SESSION TOKEN THE AUDIO ROUTE ALREADY TAKES ────────────────────
 * `GET /phone/audio/:id` carries `?token=` because a logged-in browser is the only
 * fetcher — `verifyQueryTokenUser` decodes a normal session token. A conference
 * `waitUrl`/`HoldUrl` is fetched by **SignalWire**, which has no session, and putting a
 * member of staff's session token into a URL we hand a third party would be handing out
 * their credentials.
 *
 * So this mints a token bound to ONE audio id, with the same shape and reasoning as
 * `recording-token.util.ts`: the route accepts either kind, and a token for track A
 * cannot fetch track B.
 *
 * Longer-lived than a recording token because a caller can legitimately sit on hold for
 * a while and SignalWire re-fetches the wait document each time it ends.
 */
const TTL_SECONDS = 6 * 3600;

export function signAudioToken(audioId: number): string {
  return jwt.sign({ aud_id: audioId }, process.env.JWT_SECRET ?? 'secret', {
    expiresIn: TTL_SECONDS,
  });
}

/**
 * Was `token` minted by us FOR THIS track?
 *
 * Returns a boolean rather than throwing, because the caller tries this first and falls
 * back to the session-token check — an ordinary browser request carries a session token
 * and must not be rejected just because it is not an audio token.
 */
export function isAudioTokenFor(
  token: string | undefined,
  audioId: number,
): boolean {
  try {
    const payload = jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret') as {
      aud_id?: unknown;
    };
    return payload.aud_id === audioId;
  } catch {
    return false;
  }
}

/** Throws unless the token is a valid audio token for this track. */
export function assertAudioToken(
  token: string | undefined,
  audioId: number,
): void {
  if (!isAudioTokenFor(token, audioId)) throw new UnauthorizedException();
}
