import { BadRequestException } from '@nestjs/common';

/**
 * Multer limits for dictation.
 *
 * ⚠️ 25 MB is OpenAI's own ceiling for a transcription, so anything above it could only
 * be rejected downstream after being uploaded. The browser bounds it far lower anyway —
 * `MAX_RECORDING_SEC` is five minutes — so this is the backstop, not the real limit.
 *
 * `memoryStorage` (multer's default) is justified by that cap, which is the same
 * argument the WhatsApp voice route makes and the same one `phone-audio` makes: a bounded
 * upload that is forwarded immediately never needs to touch the disk.
 */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

const ALLOWED = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
]);

/**
 * A deliberate copy of `phone-audio`'s filter rather than an import of it.
 *
 * ⚠️ `ai/` must not import from `phone/`: PhoneModule imports AiModule, and every module
 * that reaches for AiService does. `summary-reply.util.ts` states the rule in its own
 * docblock, and the direction is what keeps it true.
 */
export function transcribeFileFilter(
  _req: unknown,
  file: { mimetype: string },
  cb: (err: Error | null, ok: boolean) => void,
): void {
  const base = (file.mimetype || '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (ALLOWED.has(base) || base.startsWith('audio/')) return cb(null, true);
  cb(
    new BadRequestException('That is not an audio recording.') as Error,
    false,
  );
}
