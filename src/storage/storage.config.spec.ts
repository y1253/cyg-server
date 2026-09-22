import {
  bucketName,
  endpointFor,
  localFallbackEnabled,
  r2Config,
  storageDriver,
} from './storage.config.js';

const ACCOUNT = '27ccfb77f24a5d5ec5c5ac1328a592ac';

/** A fully configured environment, so each test can vary exactly one thing. */
const full = (over: Record<string, string | undefined> = {}) => ({
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'cyg',
  ...over,
});

describe('endpointFor', () => {
  it('derives the endpoint from the account id', () => {
    expect(endpointFor(ACCOUNT)).toBe(
      `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    );
  });

  // This test IS the host-independence guarantee: if an env var could override the
  // endpoint, a stored key would start depending on which host wrote it.
  it('is not overridable from the environment', () => {
    const cfg = r2Config(
      full({ R2_ENDPOINT: 'https://evil.example.com' } as never),
    );
    expect(cfg?.endpoint).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
  });
});

describe('bucketName', () => {
  it('reads the name and trims it', () => {
    expect(bucketName({ R2_BUCKET_NAME: '  cyg  ' })).toBe('cyg');
  });

  it('prefers R2_BUCKET over the legacy R2_BUCKET_NAME', () => {
    expect(bucketName({ R2_BUCKET: 'newer', R2_BUCKET_NAME: 'older' })).toBe(
      'newer',
    );
  });

  // A blank var means "not configured" and must fall through, never be returned as ''.
  it.each([undefined, '', '   '])('treats %p as absent', (raw) => {
    expect(bucketName({ R2_BUCKET_NAME: raw })).toBeNull();
  });

  // The regression test for the literal value server/.env shipped with: the S3 endpoint
  // URL sitting in the variable that names the bucket.
  it('throws on the endpoint URL, naming the variable and the fix', () => {
    expect(() =>
      bucketName({
        R2_BUCKET_NAME: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
      }),
    ).toThrow(/R2_BUCKET_NAME/);
    expect(() =>
      bucketName({
        R2_BUCKET_NAME: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
      }),
    ).toThrow(/bucket NAME only/);
  });

  it.each(['CYG', 'cyg/messages', 'cyg bucket', 'ab', '-cyg', 'cyg-'])(
    'throws on the malformed name %p',
    (raw) => {
      expect(() => bucketName({ R2_BUCKET_NAME: raw })).toThrow();
    },
  );
});

describe('r2Config', () => {
  it('returns every field plus the derived endpoint', () => {
    expect(r2Config(full())).toEqual({
      accountId: ACCOUNT,
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'cyg',
      endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    });
  });

  // All-or-nothing: a half-configured subsystem answers "not configured" rather than
  // failing later at the network boundary.
  it.each([
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ])('returns null when %s is blank', (name) => {
    expect(r2Config(full({ [name]: '' }))).toBeNull();
  });

  it('returns null on an empty environment rather than throwing', () => {
    expect(r2Config({})).toBeNull();
  });
});

describe('storageDriver', () => {
  it('picks r2 when unset and credentials are present', () => {
    expect(storageDriver(full())).toBe('r2');
  });

  it('picks local when unset and credentials are absent', () => {
    expect(storageDriver({})).toBe('local');
  });

  it.each(['local', 'LOCAL', ' local '])(
    'honours %p even with credentials present',
    (raw) => {
      expect(storageDriver(full({ STORAGE_DRIVER: raw }))).toBe('local');
    },
  );

  it('throws when r2 is demanded but not configured', () => {
    expect(() => storageDriver({ STORAGE_DRIVER: 'r2' })).toThrow(
      /not fully configured/,
    );
  });

  // Never silently fall back: a typo here would split the file corpus across two
  // backends, which no later fix can tidy up.
  it.each(['s3', 'disk', 'bucket', 'true'])('throws on the typo %p', (raw) => {
    expect(() => storageDriver(full({ STORAGE_DRIVER: raw }))).toThrow(
      /Valid values/,
    );
  });

  it('accepts a sloppily-spelled r2', () => {
    expect(storageDriver(full({ STORAGE_DRIVER: ' R2 ' }))).toBe('r2');
  });
});

describe('localFallbackEnabled', () => {
  it.each([undefined, '', '1', 'yes'])('defaults to on for %p', (raw) => {
    expect(localFallbackEnabled({ STORAGE_LOCAL_FALLBACK: raw })).toBe(true);
  });

  it('is disabled only by the literal "0"', () => {
    expect(localFallbackEnabled({ STORAGE_LOCAL_FALLBACK: '0' })).toBe(false);
  });
});
