import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import {
  assertRecordingToken,
  signRecordingToken,
} from './recording-token.util';

const SID_A = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
const SID_B = 'bb22cc33-dd44-ee55-ff66-778899001122';

describe('recording tokens', () => {
  const previous = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });
  afterAll(() => {
    process.env.JWT_SECRET = previous;
  });

  it('accepts a token for the recording it was minted for', () => {
    expect(() =>
      assertRecordingToken(signRecordingToken(SID_A), SID_A),
    ).not.toThrow();
  });

  it('REJECTS a valid token pointed at a different recording', () => {
    // The whole reason this exists. Without the binding, one legitimately obtained
    // token would stream any recording on the entire SignalWire account — including
    // other companies' calls.
    expect(() =>
      assertRecordingToken(signRecordingToken(SID_A), SID_B),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an ordinary session token', () => {
    // A logged-in user's own JWT must not be usable here: it proves who they are, not
    // that they were ever shown this recording.
    const session = jwt.sign({ sub: 16 }, 'test-secret');
    expect(() => assertRecordingToken(session, SID_A)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with the wrong key', () => {
    const forged = jwt.sign({ rec: SID_A }, 'not-our-secret');
    expect(() => assertRecordingToken(forged, SID_A)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', () => {
    const stale = jwt.sign({ rec: SID_A }, 'test-secret', { expiresIn: -10 });
    expect(() => assertRecordingToken(stale, SID_A)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing or malformed token', () => {
    for (const bad of [undefined, '', 'not-a-jwt']) {
      expect(() => assertRecordingToken(bad, SID_A)).toThrow(
        UnauthorizedException,
      );
    }
  });

  it('expires within the hour', () => {
    const decoded = jwt.decode(signRecordingToken(SID_A)) as {
      exp: number;
      iat: number;
    };
    expect(decoded.exp - decoded.iat).toBe(3600);
  });
});
