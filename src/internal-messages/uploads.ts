import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';

/**
 * Naming and limits for internal message attachments.
 *
 * ── THESE FILES NO LONGER LIVE ON DISK ────────────────────────────────────────
 * This used to be the place the app persisted a user-supplied file. The four permanent
 * stores — message attachments, WhatsApp media, hold music and signature logos — are now
 * in Cloudflare R2, and what is left under `UPLOADS_ROOT` is transit only: files being
 * staged on their way somewhere, deleted by the owning service in a `finally` and swept
 * hourly as a backstop.
 *
 * `MESSAGES_SUBDIR` survives that move unchanged, because it was always a RELATIVE
 * prefix: `messages/<uuid>.pdf` is now the object KEY, stored verbatim in
 * `InternalMessageAttachment.storagePath`. Nothing about the host is in it, which is why
 * changing bucket, account or server rewrites no rows.
 */

/** Root for transit directories. Override with UPLOADS_DIR in production. */
export const UPLOADS_ROOT =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

/** Key prefix for message attachments in object storage — NOT a directory any more. */
export const MESSAGES_SUBDIR = 'messages';

/**
 * Where an attachment sits while it is being uploaded.
 *
 * Its own directory rather than the email one, for the reason `staged-uploads.ts` gives:
 * mixing them makes "is this dir empty?" — the thing the hourly sweep answers —
 * answerable only per feature.
 */
export const MESSAGES_STAGING_SUBDIR = 'messages-staging';

const MESSAGES_STAGING_DIR = path.join(UPLOADS_ROOT, MESSAGES_STAGING_SUBDIR);

/**
 * Per-file ceiling — the single source of truth for BOTH message paths: outbound
 * email re-exports this as `MAX_OUTBOUND_FILE_BYTES`. Internal messages have no
 * wire limit to respect (nothing leaves this server; the recipient downloads from
 * a URL we serve), so they can afford the same cap email gets via Drive/OneDrive.
 *
 * The client mirrors it as `MAX_FILE_BYTES` in message-utils.ts so a doomed file is
 * rejected in the browser rather than uploaded and 400'd — keep the two in step.
 */
export const MAX_ATTACHMENT_BYTES = 250 * 1024 * 1024;

export const MESSAGE_MULTER_LIMITS = {
  fileSize: MAX_ATTACHMENT_BYTES,
  // A forwarded internal thread carries the whole quoted conversation in
  // `bodyHtml`, which blows past multer's 1 MB default `fieldSize` and fails with
  // an opaque LIMIT_FIELD_VALUE 500. Same value as OUTBOUND_MULTER_LIMITS.
  fieldSize: 25 * 1024 * 1024,
};

export function ensureUploadDirs(): void {
  if (!existsSync(MESSAGES_STAGING_DIR)) {
    mkdirSync(MESSAGES_STAGING_DIR, { recursive: true });
  }
}

/**
 * Resolve a stored relative path to an absolute one, refusing anything that
 * escapes the uploads root. `storagePath` comes from our own DB rather than user
 * input, but a traversal check here means a bad row can never read `/etc/passwd`.
 */
export function resolveStoredPath(storagePath: string): string {
  const abs = path.resolve(UPLOADS_ROOT, storagePath);
  const root = path.resolve(UPLOADS_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Attachment path escapes the uploads root');
  }
  return abs;
}

// `messageAttachmentStorage` was deleted with this move. Multer now writes to the staging
// directory via the shared `stagedUploadStorage(MESSAGES_STAGING_SUBDIR)`, which already
// mints the same UUID-with-sanitised-extension name — so the key shape is unchanged and
// the user-visible name still lives only in the DB `filename` column.
