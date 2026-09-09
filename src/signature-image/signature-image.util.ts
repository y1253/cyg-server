/**
 * The pure geometry behind logo normalisation.
 *
 * Kept out of the service for the same reason `luxand/face-image.ts` is kept out of
 * `face-enhancer.service.ts`: the arithmetic is where the mistakes live and it is the part
 * worth testing, while the `sharp` calls around it are not.
 */

/**
 * Longest edge a stored logo may have.
 *
 * Bounded rather than preserved, because the file an admin picks is usually a print-scale
 * asset and every recipient would pay for those bytes on every email. 600 leaves room for
 * a retina render of the ~180px the signature actually displays it at.
 */
export const MAX_LOGO_EDGE_PX = 600;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * The size to store this image at.
 *
 * **Only ever shrinks.** Upscaling a small logo would invent detail and cost bytes for
 * nothing — the same rule the face pipeline follows in the other direction with its 2x
 * cap. An image already inside the bound is returned untouched, which is what makes
 * re-encoding idempotent for the common case.
 *
 * Aspect ratio is preserved by scaling both edges by one factor, so a wide banner logo and
 * a square mark both end up bounded without either being distorted.
 */
export function boundedSize(source: Dimensions): Dimensions {
  const longest = Math.max(source.width, source.height);
  if (longest <= MAX_LOGO_EDGE_PX) return { ...source };
  const scale = MAX_LOGO_EDGE_PX / longest;
  return {
    // `max(1, …)` so an extreme aspect ratio cannot round the short edge to zero, which
    // sharp rejects outright.
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * The label a freshly uploaded file gets when the admin does not type one.
 *
 * Mirrors `PhoneAudioService.defaultName`: the basename without its extension, capped, with
 * a fallback so an oddly named file still produces something clickable.
 */
export function defaultImageName(originalName: string): string {
  const base = (originalName ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .trim();
  return base.slice(0, 80) || 'Untitled';
}
