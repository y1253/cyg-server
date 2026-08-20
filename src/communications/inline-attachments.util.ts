// ─── Inline-attachment classification (shared by the provider services) ──────
//
// An attachment is "inline" only when the HTML body actually embeds it with a
// matching `cid:` reference. That single rule decides whether the file is hidden
// from the attachment strip, and getting it wrong is expensive in both
// directions:
//
//   - Too eager, and real files vanish from the UI entirely. Mail clients stamp
//     `Content-Disposition: inline` on every image (pasted screenshots, Apple
//     Mail, Outlook's "picture in body"), and Graph sets `isInline` just as
//     freely — so trusting either flag on its own hides images and almost
//     nothing else. Worse, an image flagged inline whose Content-ID the body
//     never references renders in neither place: not in the body, not in the
//     strip.
//   - Too lax, and every signature logo becomes an attachment tile.
//
// A Content-ID on its own is likewise not enough — many clients stamp one on
// ordinary attachments. It has to be referenced.

/**
 * The set of `cid:` values an HTML body actually embeds.
 *
 * Both the raw and percent-decoded forms are stored, because senders differ on
 * whether they encode the Content-ID inside the `src` attribute.
 */
export function referencedCidsFromHtml(
  bodyHtml: string | null | undefined,
): Set<string> {
  const referencedCids = new Set<string>();
  for (const m of (bodyHtml ?? '').matchAll(/cid:([^"'>\s)]+)/gi)) {
    referencedCids.add(m[1]);
    try {
      referencedCids.add(decodeURIComponent(m[1]));
    } catch {
      // keep raw cid if it isn't valid percent-encoding
    }
  }
  return referencedCids;
}

/** Strip the angle brackets a raw `Content-ID` header carries: `<abc@x>` → `abc@x`. */
export function normalizeContentId(
  rawContentId: string | null | undefined,
): string | null {
  if (!rawContentId) return null;
  const trimmed = rawContentId.trim().replace(/^<|>$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Is this attachment rendered inside the body (and therefore hidden from the
 * attachment strip)? True only when the body embeds its Content-ID.
 */
export function isBodyEmbedded(
  contentId: string | null | undefined,
  referencedCids: Set<string>,
): boolean {
  const id = normalizeContentId(contentId);
  return id !== null && referencedCids.has(id);
}
