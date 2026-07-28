import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';

/**
 * On-disk storage for internal message attachments.
 *
 * This is the ONLY place the app persists a user-supplied file. Every other upload
 * (face photos, outbound email attachments) is a pass-through to an external API
 * and never touches disk, so there was no existing convention to follow.
 *
 * Files live outside the repo tree's tracked content (`server/uploads/` is
 * gitignored) so `deploy.sh`'s `git pull` + `npm ci` leaves them intact.
 */

/** Root for all uploads. Override with UPLOADS_DIR in production. */
export const UPLOADS_ROOT =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

/** Sub-path (relative to UPLOADS_ROOT) that message attachments are written to. */
export const MESSAGES_SUBDIR = 'messages';

const MESSAGES_DIR = path.join(UPLOADS_ROOT, MESSAGES_SUBDIR);

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB, same as email send

export function ensureUploadDirs(): void {
  if (!existsSync(MESSAGES_DIR)) mkdirSync(MESSAGES_DIR, { recursive: true });
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

/**
 * Multer storage: random UUID filename, original extension preserved only so the
 * OS/mime sniffing behaves. The user-visible name is kept in the DB `filename`
 * column, never on disk — so a hostile filename can't shape the path.
 */
export const messageAttachmentStorage = diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDirs();
    cb(null, MESSAGES_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    const safeExt = /^\.[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : '';
    cb(null, `${randomUUID()}${safeExt}`);
  },
});
