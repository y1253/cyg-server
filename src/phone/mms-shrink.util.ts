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
 * How many bytes each file may take, given how many are being sent.
 *
 * An even split. Not a per-file constant: the carrier's ceiling applies to the MESSAGE, so
 * three photos each just inside a per-file limit would produce a message three times over
 * it — the case a per-file cap looks like it handles and does not.
 */
export function perFileBudget(total: number, fileCount: number): number {
  return Math.max(1, Math.floor(total / Math.max(1, fileCount)));
}

/** The only types a carrier reliably renders in a picture message. */
const MMS_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/** What each accepted extension really is, for the corroboration rule below. */
const MMS_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * May this file ride on a text message?
 *
 * ── WHY A NARROW ALLOW-LIST, NOT `mimetype.startsWith('image/')` ───────────────
 * `signature-image.storage.ts#imageFileFilter` does exactly that and is right for its own
 * purpose, where `sharp` decodes the file and the result is a PNG we serve ourselves.
 * Here the bytes go to a CARRIER, and the set a carrier actually renders is much smaller.
 * A prefix test lets `image/heic` through — which is what an iPhone sends by default —
 * and it then fails inside `sharp` and surfaces as "That picture is too large to send",
 * a sentence that is simply untrue. Refusing it up front says something the sender can
 * act on.
 *
 * ⚠️ `mimetype` is CLIENT-SUPPLIED, so the filename has to CORROBORATE it, not merely
 * fail to contradict it — the `whatsappMediaKind` rule verbatim. An unrecognised
 * extension is refused as well as a conflicting one; a file with no extension at all is
 * judged on its declared type alone, because there is nothing to disagree with.
 */
export function isMmsImage(
  mimetype: string | undefined,
  filename: string | undefined,
): boolean {
  const base = (mimetype ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!MMS_IMAGE_MIMES.has(base)) return false;

  const name = filename ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
  if (!ext) return true;
  return MMS_MIME_BY_EXTENSION[ext] === base;
}
