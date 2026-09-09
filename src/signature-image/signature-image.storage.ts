import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { memoryStorage } from 'multer';
import { UPLOADS_ROOT } from '../internal-messages/uploads.js';

/**
 * On-disk storage for admin-uploaded signature logos.
 *
 * Mirrors `phone-audio.storage.ts`, and for the same reason: the bytes that arrive are NOT
 * the bytes we keep. Every upload is re-encoded to a bounded PNG before being written, so
 * what lands on disk always has a known format and a known mimeType, and mail-client image
 * support stops being a runtime concern. That is why this uses `memoryStorage` rather than
 * `diskStorage` — the original never needs to exist as a file — and the small ceiling below
 * is what makes holding it in a buffer safe.
 */

/** Sub-path (relative to UPLOADS_ROOT) that logos are written to. */
export const SIGNATURE_IMAGE_SUBDIR = 'signature-images';

export const SIGNATURE_IMAGE_DIR = path.join(
  UPLOADS_ROOT,
  SIGNATURE_IMAGE_SUBDIR,
);

/**
 * Per-file ceiling, 4x smaller than hold music's.
 *
 * A signature logo is a small graphic that will be re-encoded down to a few hundred pixels
 * anyway, so anything approaching this is already a mistake — and a low cap is what keeps
 * decoding the original in memory honest.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const SIGNATURE_IMAGE_MULTER_LIMITS = {
  fileSize: MAX_IMAGE_BYTES,
  files: 1,
};

/**
 * Type check, modelled on `audioFileFilter`.
 *
 * It guards against mistakes, not attackers: sharp is what actually decides whether the
 * bytes are an image, and a lie about the mimetype fails there anyway. Rejecting early just
 * turns a decode error into a sentence an admin can act on.
 *
 * The extension fallback matters in practice — browsers are inconsistent about SVG and
 * about files dragged in from odd sources, and some send an empty mimetype.
 */
export function imageFileFilter(
  _req: unknown,
  file: { mimetype: string; originalname: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  const ok =
    file.mimetype.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|tiff?|avif)$/i.test(file.originalname);
  if (!ok) {
    cb(new Error('Only image files can be uploaded here'), false);
    return;
  }
  cb(null, true);
}

export const signatureImageStorage = memoryStorage();

export function ensureSignatureImageDir(): void {
  if (!existsSync(SIGNATURE_IMAGE_DIR))
    mkdirSync(SIGNATURE_IMAGE_DIR, { recursive: true });
}

/** Relative storage path for a freshly encoded logo, e.g. "signature-images/<uuid>.png". */
export function newImageStoragePath(): string {
  return `${SIGNATURE_IMAGE_SUBDIR}/${randomUUID()}.png`;
}
