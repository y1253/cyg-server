import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import type { StorageEngine } from 'multer';
import { UPLOADS_ROOT } from '../internal-messages/uploads.js';

/**
 * Multer disk storage for a file that is pure TRANSIT.
 *
 * `outbound-uploads.ts` already does this for email attachments, and its reasoning holds
 * for any large upload: a file measured in tens of megabytes must not sit in RAM, because
 * the copies multiply — multer's buffer, whatever the provider client makes of it, and any
 * encoded form on top. What it does not offer is a SECOND staging directory, and mixing
 * WhatsApp's in-flight attachments into the email one would make "is this dir empty?" — the
 * thing `OutboundCleanupService` sweeps on — answerable only per feature.
 *
 * So the directory is a parameter and everything else is shared: UUID filenames (the real
 * name lives in the DB, as everywhere else here), a sanitised extension, and the same
 * rule that the owning service deletes the file in a `finally`.
 */
export function stagedUploadStorage(subdir: string): StorageEngine {
  const dir = path.join(UPLOADS_ROOT, subdir);
  return diskStorage({
    destination: (_req, _file, cb) => {
      // Created lazily rather than at import: the directory is only needed once somebody
      // actually attaches something, and a read-only volume should not fail the boot.
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Kept for the same reason the email path keeps it: an extension makes a stray file
      // identifiable when somebody is looking at the staging directory wondering what
      // failed. It is never trusted as a type — `whatsappMediaKind` decides that.
      const ext = path.extname(file.originalname).slice(0, 12);
      const safeExt = /^\.[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : '';
      cb(null, `${randomUUID()}${safeExt}`);
    },
  });
}
