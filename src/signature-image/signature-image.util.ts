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

// ─── Scope: firm-wide library vs one company's ───────────────────────────────

/**
 * Which library a logo lives in. `null` = firm-wide.
 *
 * Doubles as the "who is asking" type: the firm-wide default asks with `null`, a company
 * asks with its own id. That is what lets ONE pair of predicates answer for both, instead
 * of a firm-wide rule and a per-company rule that drift apart.
 */
export type ImageScope = number | null;

/**
 * May this scope OFFER this logo in its picker, and point a settings row at it?
 *
 * A firm-wide logo is visible to everyone; a company's own logo is visible only to that
 * company. Called with `scope = null` it correctly collapses to "firm-wide only", which is
 * the rule that keeps a per-company upload out of the firm-wide default.
 */
export function isImageVisibleTo(image: ImageScope, scope: ImageScope): boolean {
  return image === null || image === scope;
}

/**
 * May this scope RENAME OR DELETE this logo?
 *
 * Strictly narrower than `isImageVisibleTo`, and that gap is the point: a company USES the
 * firm-wide logos and must never be able to edit one. Symmetric on purpose — it also stops
 * the ADMIN library routes touching a company's logo, which they never list anyway.
 */
export function isImageInLibrary(image: ImageScope, scope: ImageScope): boolean {
  return image === scope;
}

/**
 * The Prisma `where` twin of `isImageVisibleTo`.
 *
 * It lives beside it and is pinned by the same spec, because a list that disagrees with the
 * write-time check is how a logo turns up in a picker that then refuses to save it.
 */
export function imageScopeWhere(scope: ImageScope) {
  return scope === null
    ? { companyId: null }
    : { OR: [{ companyId: null }, { companyId: scope }] };
}

/**
 * Per-company ceiling on uploads.
 *
 * A company needs one logo; ten is already a mistake. This is the only new write-to-disk
 * surface a MANAGER gains, and while the 5 MB / 1-file multer limits bound each request,
 * nothing else bounds the count.
 */
export const MAX_COMPANY_LOGOS = 10;
