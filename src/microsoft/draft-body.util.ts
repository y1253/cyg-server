// ─── Reply/forward draft body composition ────────────────────────────────────
// Graph's `createReply` / `createForward` return a draft whose body is a FULL
// HTML document: the quoted original lives in <body>, but the formatting that
// renders it lives in <head><style>. Replacing `body.content` with just the
// user's HTML therefore throws the quote away, and concatenating puts our markup
// outside <html>. Both are silent — the send succeeds and the recipient gets a
// stripped message — so the splice below is the only correct merge.

/**
 * Inserts `userHtml` immediately after the draft's opening <body> tag, leaving
 * Graph's quoted original (and the <head> that styles it) untouched below it.
 * That ordering matches what Outlook web produces for a reply.
 *
 * Falls back to plain concatenation when the draft has no <body> tag, and to the
 * user's HTML alone when the draft body is empty.
 */
export function insertAboveQuote(userHtml: string, draftHtml: string): string {
  if (!draftHtml) return userHtml;
  if (!userHtml) return draftHtml;
  const openBody = /<body\b[^>]*>/i.exec(draftHtml);
  if (!openBody) return `${userHtml}<br>${draftHtml}`;
  const at = openBody.index + openBody[0].length;
  return draftHtml.slice(0, at) + userHtml + draftHtml.slice(at);
}

/**
 * Minimal plain-text → HTML for the rare send that has no `bodyHtml`. The draft
 * body is always HTML (the quote is), so a text body has to be escaped and
 * line-broken rather than spliced in raw.
 */
export function textToHtml(text: string): string {
  const escaped = (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div>${escaped.replace(/\r?\n/g, '<br>')}</div>`;
}
