/**
 * The pure arithmetic behind fitting attachments into an MMS.
 *
 * Kept out of the service for the reason `signature-image.util.ts` gives about `sharp`, and
 * `phone-timeline.util.ts` gives about the whole module: the numbers are where the mistakes
 * live and are worth testing; the encoder calls around them are not.
 */

/** One rung of the re-encode ladder: how big, and how hard to squeeze. */
export interface ImageRung {
  /** Longest edge in pixels. */
  edge: number;
  /** JPEG quality, 1-100. */
  quality: number;
}

/**
 * Successively harsher re-encodes, tried in order until one fits the budget.
 *
 * A ladder rather than one computed quality, because the relationship between JPEG quality
 * and output size depends entirely on the picture — a flat screenshot and a detailed photo
 * at q75 differ by an order of magnitude, so the size has to be MEASURED rather than
 * predicted. Three rungs is enough: 1600px/q80 keeps a phone photo looking like one, and
 * 640px/q45 will fit essentially anything a camera produces inside a megabyte.
 *
 * ⚠️ Never upscales. The first rung's edge is a ceiling applied with `fit: 'inside'`, so a
 * small image simply passes through — the rule `boundedSize` states for logos.
 */
export const MMS_IMAGE_LADDER: readonly ImageRung[] = [
  { edge: 1600, quality: 80 },
  { edge: 1024, quality: 65 },
  { edge: 640, quality: 45 },
];

/**
 * Audio re-encode for MMS: mono, 16 kHz, 32 kbps mp3.
 *
 * Its OWN constant, never shared with `TELEPHONY_MP3_ARGS` or `TRANSCRIBE_MP3_ARGS`. Those
 * are load-bearing for the hold-music player and the transcriber respectively, and retuning
 * a shared constant for a new consumer is how the first one silently breaks — the rule
 * `WHATSAPP_VOICE_ARGS` states for itself.
 *
 * 32 kbps mono is telephone quality, which is what a voice clip on a text message is: it
 * buys roughly four minutes inside the budget, where a music-grade encode buys thirty
 * seconds.
 */
export const MMS_AUDIO_ARGS = [
  '-vn',
  '-ac',
  '1',
  '-ar',
  '16000',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '32k',
  '-f',
  'mp3',
];

/**
 * How many bytes each file may take, given how many are being sent.
 *
 * An even split. Not a per-file constant: the carrier's ceiling applies to the MESSAGE, so
 * three photos each just inside a per-file limit would produce a message three times over
 * it — the case a per-file cap looks like it handles and does not.
 */
export function perFileBudget(total: number, fileCount: number): number {
  return Math.max(1, Math.floor(total / Math.max(1, fileCount)));
}

/** Is this something we can re-encode smaller, or must it fit as-is? */
export function mmsMediaClass(
  contentType: string | undefined,
): 'image' | 'audio' | 'other' {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.startsWith('image/')) return 'image';
  if (base.startsWith('audio/')) return 'audio';
  return 'other';
}
