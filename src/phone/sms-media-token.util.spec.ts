import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { assertSmsMediaToken, signSmsMediaToken } from './sms-media-token.util';

describe('sms media tokens', () => {
  const OLD = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });
  afterAll(() => {
    process.env.JWT_SECRET = OLD;
  });

  it('accepts a token minted for the same attachment', () => {
    expect(() =>
      assertSmsMediaToken(signSmsMediaToken('MSG', 'MED'), 'MSG', 'MED'),
    ).not.toThrow();
  });

  /**
   * The binding is the point. Without it the route would accept any valid token for any
   * media sid on the whole account — and "hard to guess" is not an access control.
   */
  it('refuses a token minted for another attachment on the SAME message', () => {
    const token = signSmsMediaToken('MSG', 'MED-1');
    expect(() => assertSmsMediaToken(token, 'MSG', 'MED-2')).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a token minted for another message', () => {
    const token = signSmsMediaToken('MSG-1', 'MED');
    expect(() => assertSmsMediaToken(token, 'MSG-2', 'MED')).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a missing, malformed or foreign-signed token', () => {
    expect(() => assertSmsMediaToken(undefined, 'M', 'D')).toThrow(UnauthorizedException);
    expect(() => assertSmsMediaToken('nonsense', 'M', 'D')).toThrow(UnauthorizedException);
    const foreign = jwt.sign({ msg: 'M', med: 'D' }, 'a-different-secret');
    expect(() => assertSmsMediaToken(foreign, 'M', 'D')).toThrow(UnauthorizedException);
  });

  it('refuses an expired token', () => {
    const expired = jwt.sign({ msg: 'M', med: 'D' }, 'test-secret', {
      expiresIn: -10,
    });
    expect(() => assertSmsMediaToken(expired, 'M', 'D')).toThrow(UnauthorizedException);
  });
});
