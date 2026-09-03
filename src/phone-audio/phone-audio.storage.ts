import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { memoryStorage } from 'multer';
import { UPLOADS_ROOT } from '../internal-messages/uploads.js';

/**
 * On-disk storage for admin-uploaded hold music.
 *
 * Unlike message attachments, the bytes that arrive are NOT the bytes we keep: every upload
 * is transcoded to mono mp3 before being written, so what lands on disk always has a known
 * format and a known mimeType. That is why this uses `memoryStorage` rather than
 * `diskStorage` — the original never needs to exist as a file, and the 20 MB ceiling below
 * is what makes holding it in a buffer safe.
 */

/** Sub-path (relative to UPLOADS_ROOT) that hold music is written to. */
export const PHONE_AUDIO_SUBDIR = 'phone-audio';

export const PHONE_AUDIO_DIR = path.join(UPLOADS_ROOT, PHONE_AUDIO_SUBDIR);

/**
 * Per-file ceiling — deliberately 12x smaller than MAX_ATTACHMENT_BYTES. This is a looping
 * telephony clip, not a video someone emailed, and the small cap is also what keeps
 * in-memory transcoding honest.
 */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export const PHONE_AUDIO_MULTER_LIMITS = {
  fileSize: MAX_AUDIO_BYTES,
  files: 1,
};

/**
 * The codebase's first upload type check — every other upload route accepts anything.
 *
 * It guards against mistakes, not attackers: ffmpeg is what actually decides whether the
 * bytes are audio, and a lie about the mimetype fails there anyway. Rejecting early just
 * turns "ffmpeg exited 1" into a sentence an admin can act on.
 *
 * The extension fallback matters in practice — browsers label .wav as anything from
 * `audio/wav` to `audio/x-pn-wav` to an empty string.
 */
export function audioFileFilter(
  _req: unknown,
  file: { mimetype: string; originalname: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  const ok =
    file.mimetype.startsWith('audio/') ||
    /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname);
  if (!ok) {
    cb(new Error('Only audio files can be uploaded here'), false);
    return;
  }
  cb(null, true);
}

export const phoneAudioStorage = memoryStorage();

export function ensurePhoneAudioDir(): void {
  if (!existsSync(PHONE_AUDIO_DIR))
    mkdirSync(PHONE_AUDIO_DIR, { recursive: true });
}

/** Relative storage path for a freshly transcoded track, e.g. "phone-audio/<uuid>.mp3". */
export function newAudioStoragePath(): string {
  return `${PHONE_AUDIO_SUBDIR}/${randomUUID()}.mp3`;
}
