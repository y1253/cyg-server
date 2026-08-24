/**
 * Small pure helpers for building a notification preview. Shared by both providers
 * and unit-tested, because the parsing is fiddly enough to get quietly wrong.
 */

/**
 * Gmail returns `snippet` HTML-escaped ("Bob&#39;s invoice &amp; receipt"), which
 * looks like markup leaking into a popup. Only the five named entities Gmail
 * actually emits, plus numeric ones — this is a display nicety, not a sanitizer,
 * and the result is rendered as text, never as HTML.
 */
export function decodeHtmlEntities(text: string): string {
  return (
    text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&#x0*27;/gi, "'")
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      // Last: an escaped ampersand must not revive the entity that followed it.
      .replace(/&amp;/g, '&')
  );
}

/**
 * The human-readable half of an RFC 5322 From header.
 *
 * `"Doe, Jane" <j@x.com>` → `Doe, Jane`; a bare `j@x.com` → `j@x.com`. Falls back to
 * the whole header rather than an empty string, since a popup with an odd-looking
 * sender still beats a popup with none.
 */
export function fromDisplayName(header: string): string {
  const raw = header.trim();
  if (!raw) return '';

  const angle = raw.lastIndexOf('<');
  const name = angle === -1 ? '' : raw.slice(0, angle).trim();
  if (name) {
    // Strip surrounding quotes and unescape what quoting protected.
    const unquoted = /^"(.*)"$/s.exec(name);
    return (unquoted ? unquoted[1].replace(/\\(.)/g, '$1') : name).trim();
  }

  if (angle !== -1) {
    const close = raw.indexOf('>', angle);
    const addr = raw.slice(angle + 1, close === -1 ? undefined : close).trim();
    if (addr) return addr;
  }
  return raw;
}
