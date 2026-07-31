// ─── "Shared via Drive/OneDrive" body block ──────────────────────────────────
// An attachment too big to ride inside the message is uploaded to the connected
// account's own Drive/OneDrive and linked from the body instead. This builds that
// block for both the HTML and the plain-text alternative, so a text-only reader
// still gets working URLs.
//
// All styling is inline: email clients drop <style> blocks, and this markup is
// spliced into a body that may already be a full HTML document (Graph's
// reply/forward drafts are — see draft-body.util.ts).

export type LinkProvider = 'drive' | 'onedrive';

export interface SharedLink {
  /** The user-visible filename (never the temp path). */
  name: string;
  size: number;
  url: string;
}

const PROVIDER_LABEL: Record<LinkProvider, string> = {
  drive: 'Google Drive',
  onedrive: 'OneDrive',
};

function escapeHtml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Human-readable size. Mirrors `formatBytes` in the client's message-utils.ts. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function buildLinkBlockHtml(
  links: SharedLink[],
  provider: LinkProvider,
): string {
  if (links.length === 0) return '';
  const label = PROVIDER_LABEL[provider];
  const heading =
    links.length === 1
      ? `1 file shared via ${label}`
      : `${links.length} files shared via ${label}`;

  const rows = links
    .map((l) => {
      const size = formatBytes(l.size);
      return (
        '<div style="padding:6px 0;">' +
        // The href is a provider-issued https URL, never user input — but escape
        // it anyway so a stray quote can't break out of the attribute.
        `<a href="${escapeHtml(l.url)}" style="color:#0b66c3;text-decoration:none;font-weight:600;">${escapeHtml(l.name)}</a>` +
        (size
          ? `<span style="color:#5f6368;font-size:12px;"> &nbsp;${escapeHtml(size)}</span>`
          : '') +
        '</div>'
      );
    })
    .join('');

  return (
    '<div style="margin-top:16px;padding:12px 16px;border:1px solid #dadce0;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;">' +
    `<div style="color:#5f6368;font-size:12px;margin-bottom:4px;">${escapeHtml(heading)}</div>` +
    rows +
    '</div>'
  );
}

export function buildLinkBlockText(
  links: SharedLink[],
  provider: LinkProvider,
): string {
  if (links.length === 0) return '';
  const label = PROVIDER_LABEL[provider];
  const heading =
    links.length === 1
      ? `1 file shared via ${label}:`
      : `${links.length} files shared via ${label}:`;
  const rows = links.map((l) => {
    const size = formatBytes(l.size);
    return `${l.name}${size ? ` (${size})` : ''}\n${l.url}`;
  });
  return `\n\n${heading}\n${rows.join('\n')}`;
}

/**
 * Append the block to a message body pair. Returns new strings rather than
 * mutating the DTO, and is a no-op when nothing was linked.
 *
 * The HTML block goes on the end of the *user's* HTML, before any quoted original
 * is spliced in — `insertAboveQuote` then keeps it above the quote, where Gmail
 * and Outlook put their own versions of this block.
 */
export function appendLinkBlock(
  body: string,
  bodyHtml: string | undefined,
  links: SharedLink[],
  provider: LinkProvider,
): { body: string; bodyHtml?: string } {
  if (links.length === 0) return { body, bodyHtml };
  return {
    body: `${body ?? ''}${buildLinkBlockText(links, provider)}`,
    bodyHtml: bodyHtml
      ? `${bodyHtml}${buildLinkBlockHtml(links, provider)}`
      : bodyHtml,
  };
}
