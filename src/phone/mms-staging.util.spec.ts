import { UnauthorizedException } from '@nestjs/common';
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  assertMmsToken,
  resolveStagedMms,
  signMmsToken,
  MAX_MMS_TOTAL_BYTES,
  MAX_MMS_FILES,
} from './mms-staging.util';

describe('mms staging tokens', () => {
  const OLD = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });
  afterAll(() => {
    process.env.JWT_SECRET = OLD;
  });

  it('accepts the file it was minted for', () => {
    expect(() => assertMmsToken(signMmsToken('a.jpg'), 'a.jpg')).not.toThrow();
  });

  /**
   * The staging directory holds one client's document next to another's, on a route with
   * no session behind it — the whole reason this is not just an unguessable filename.
   */
  it('refuses a token minted for a different staged file', () => {
    expect(() => assertMmsToken(signMmsToken('a.jpg'), 'b.jpg')).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a missing or malformed token', () => {
    expect(() => assertMmsToken(undefined, 'a.jpg')).toThrow(UnauthorizedException);
    expect(() => assertMmsToken('nope', 'a.jpg')).toThrow(UnauthorizedException);
  });
});

describe('resolveStagedMms', () => {
  it('accepts the UUID shape the staging storage mints', () => {
    const name = '3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg';
    expect(resolveStagedMms(name)).toContain(name);
    expect(resolveStagedMms('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).not.toBeNull();
  });

  /**
   * The name arrives in a URL on an UNGUARDED route, so it is hostile input. A narrow
   * allow-list rather than a traversal check, because only one shape is ever legal.
   */
  it('refuses traversal, absolute paths and anything else', () => {
    expect(resolveStagedMms('../../.env')).toBeNull();
    expect(resolveStagedMms('/etc/passwd')).toBeNull();
    expect(resolveStagedMms('..')).toBeNull();
    expect(resolveStagedMms('3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg/../x')).toBeNull();
    expect(resolveStagedMms('not-a-uuid.jpg')).toBeNull();
  });
});

describe('mms budgets', () => {
  /**
   * Carrier limits, not provider limits. SignalWire takes ~5 MB; a large share of North
   * American carriers silently DROP a message much over 1 MB — and a message that reports
   * `sent` and never arrives is the failure the shrink path exists to prevent.
   */
  it('budgets a megabyte in total, over at most three files', () => {
    expect(MAX_MMS_TOTAL_BYTES).toBe(1024 * 1024);
    expect(MAX_MMS_FILES).toBe(3);
  });
});
