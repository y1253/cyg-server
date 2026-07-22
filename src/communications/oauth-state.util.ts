import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

// ─── OAuth `state` signing (shared by Gmail + Microsoft) ─────────────────────
// The state carries the companyId + userId through the OAuth redirect, HMAC-signed
// with JWT_SECRET and time-boxed to 10 minutes so a callback can't be forged or
// replayed. (GmailService keeps a private equivalent; new providers use this one.)

export function generateOAuthState(companyId: number, userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ companyId, userId, ts: Date.now() }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET ?? 'secret')
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): {
  companyId: number;
  userId: number;
} {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new UnauthorizedException('Invalid state');
  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = crypto
    .createHmac('sha256', process.env.JWT_SECRET ?? 'secret')
    .update(payload)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new UnauthorizedException('Invalid state signature');
  }
  const parsed = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as { companyId: number; userId: number; ts: number };
  if (Date.now() - parsed.ts > 10 * 60 * 1000) {
    throw new UnauthorizedException('State expired');
  }
  return { companyId: parsed.companyId, userId: parsed.userId };
}
