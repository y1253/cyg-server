/**
 * Where persisted user files live, and how to reach them.
 *
 * Pure functions over an `env` object, following `phone/phone.config.ts` — so every
 * rule below is testable against a literal, with no process environment involved.
 *
 * ── THE ENDPOINT IS DERIVED, NEVER READ FROM ENV ──────────────────────────────
 * `endpointFor()` builds it from the account id alone. That is the whole of the
 * "changing host must not affect data" guarantee: a stored key like
 * `whatsapp/<uuid>.ogg` names no account, no bucket and no hostname, so moving
 * account, bucket, region — or back to local disk — is an `.env` edit and touches
 * not one database row.
 */

export type StorageDriver = 'r2' | 'local';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Derived from `accountId`. Deliberately not configurable — see the file docblock. */
  endpoint: string;
}

type Env = Record<string, string | undefined>;

/** A blank env var means NOT CONFIGURED, never an empty value. See phone.config.ts:70-77. */
const value = (raw: string | undefined): string => (raw ?? '').trim();

/**
 * R2 bucket names are lowercase alphanumerics and hyphens, 3-63 characters, starting
 * and ending on an alphanumeric.
 */
const BUCKET_SHAPE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function endpointFor(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * The bucket NAME, or null when unset.
 *
 * ⚠️ Throws on a value that is present but malformed, and the distinction is the point:
 * blank means "not configured" and falls through to the local driver, while a bucket
 * that cannot work means somebody configured this and got it wrong.
 *
 * This is not hypothetical. `server/.env` shipped with
 * `R2_BUCKET_NAME=https://<account>.r2.cloudflarestorage.com` — the S3 *endpoint*, in
 * the variable that names the bucket. Accepting it would have produced a 400 on every
 * upload and every download, i.e. the failure surfaces in a client's face on a Tuesday
 * afternoon rather than in the deploy log ten seconds after the restart. There is no
 * safe default to fall back to here, so the only useful thing a misconfiguration can do
 * is refuse to start.
 */
export function bucketName(env: Env): string | null {
  const raw = value(env.R2_BUCKET) || value(env.R2_BUCKET_NAME);
  if (raw === '') return null;
  if (!BUCKET_SHAPE.test(raw)) {
    throw new Error(
      `R2_BUCKET_NAME is "${raw}", which is not a bucket name. ` +
        'Set R2_BUCKET_NAME=cyg — this variable is the bucket NAME only; the endpoint ' +
        'is derived from R2_ACCOUNT_ID.',
    );
  }
  return raw;
}

/**
 * Everything needed to talk to R2, or null if any part of it is missing.
 *
 * All-or-nothing, following `sipCredentials` (phone.config.ts:156-168): a partially
 * configured subsystem answers "not configured" so the caller can say so explicitly,
 * rather than failing later at the network boundary where the cause is unrecoverable
 * from the error.
 */
export function r2Config(env: Env): R2Config | null {
  const accountId = value(env.R2_ACCOUNT_ID);
  const accessKeyId = value(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = value(env.R2_SECRET_ACCESS_KEY);
  // Deliberately last: a malformed bucket throws, and it should only do so once the
  // rest of the credentials show that R2 was actually intended.
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  const bucket = bucketName(env);
  if (!bucket) return null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: endpointFor(accountId),
  };
}

/**
 * Which backend persists files.
 *
 * | STORAGE_DRIVER | credentials | result |
 * |---|---|---|
 * | unset / blank  | present     | `r2`                    |
 * | unset / blank  | absent      | `local` (dev machines)  |
 * | `local`        | either      | `local` — the documented rollback |
 * | `r2`           | absent      | **throws** |
 * | anything else  | either      | **throws** |
 *
 * ⚠️ The last row is deliberately NOT `minRecordingSeconds`'s "fall back rather than
 * throw" (phone.config.ts:213-220). A typo in a display heuristic costs a wrong number
 * on a screen; a typo here sends a client's documents to the wrong backend and splits
 * the corpus across two of them, which is the one failure no later fix can tidy up.
 *
 * ⚠️ `local` is a rollback for the WRITE path only. Once the migration script has
 * deleted the local copies, switching back makes every pre-migration file 404 — the
 * fallback in `stored-object.ts` reads R2→disk, never disk→R2.
 */
export function storageDriver(env: Env): StorageDriver {
  const raw = value(env.STORAGE_DRIVER).toLowerCase();
  if (raw === 'local') return 'local';

  if (raw === '') return r2Config(env) ? 'r2' : 'local';

  if (raw === 'r2') {
    if (!r2Config(env)) {
      throw new Error(
        'STORAGE_DRIVER=r2 but R2 is not fully configured. Set R2_ACCOUNT_ID, ' +
          'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME — or set ' +
          'STORAGE_DRIVER=local to keep files on disk.',
      );
    }
    return 'r2';
  }

  throw new Error(
    `STORAGE_DRIVER is "${raw}". Valid values are "r2", "local", or blank ` +
      '(which picks r2 when credentials are present).',
  );
}

/**
 * Whether a file missing from R2 may still be served off local disk.
 *
 * Default ON, disabled by `'0'` — the `recordMode` asymmetry (phone.config.ts:193-200),
 * because the cost of having it wrongly on is one `stat` on an already-failed request,
 * while the cost of having it wrongly off is every not-yet-migrated attachment 404ing.
 *
 * It exists for the rollout window: the code deploys before the migration script runs,
 * so for that period the bytes are still only on disk. Switch it off (env edit, no
 * deploy) once `grep UPLOADS_FALLBACK` in the pm2 log has been silent, then delete the
 * fallback arm.
 */
export function localFallbackEnabled(env: Env): boolean {
  return value(env.STORAGE_LOCAL_FALLBACK) !== '0';
}
