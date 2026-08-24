/**
 * Gmail-style advanced search, compiled per provider.
 *
 * The panel's fields travel the wire STRUCTURED rather than as a pre-built query
 * string, because the two providers do not speak the same language: Gmail takes
 * its own operator syntax (`from:`, `larger:5M`, `-word`) while Microsoft Graph
 * takes KQL (`from:`, `size>5242880`, `NOT(word)`). One client-composed string
 * could only ever be right for one of them.
 *
 * Compilation happens at the controller boundary and the result is handed to the
 * existing `q` parameter, so `getEmails` and `getUncompletedEmailIds` keep working
 * unchanged — both already forward `q` to the provider verbatim.
 */

export type SizeOp = 'gt' | 'lt';
export type SearchWithin = '1d' | '3d' | '1w' | '2w' | '1m' | '2m' | '6m' | '1y';
export type SearchScope = 'all' | 'inbox' | 'sent' | 'spam' | 'trash';

export interface EmailSearchFilters {
  from?: string;
  to?: string;
  subject?: string;
  /** "Has the words" */
  words?: string;
  /** "Doesn't have" */
  notWords?: string;
  sizeOp?: SizeOp;
  sizeBytes?: number;
  within?: SearchWithin;
  /** yyyy-mm-dd the `within` window is centred on. Defaults to today. */
  anchor?: string;
  hasAttachment?: boolean;
  scope?: SearchScope;
}

const WITHIN_DAYS: Record<SearchWithin, number> = {
  '1d': 1,
  '3d': 3,
  '1w': 7,
  '2w': 14,
  '1m': 30,
  '2m': 60,
  '6m': 182,
  '1y': 365,
};

const SCOPES: SearchScope[] = ['all', 'inbox', 'sent', 'spam', 'trash'];
const WITHINS = Object.keys(WITHIN_DAYS) as SearchWithin[];

/** Strip an empty/whitespace value down to undefined so it never reaches a query. */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read the panel's fields off a raw query object.
 *
 * Never throws: anything unparseable is dropped rather than 400'ing a search. A
 * partly-understood filter still returns useful mail; a rejected request returns
 * none. Returns undefined when nothing usable was supplied, so callers can keep
 * the plain free-text path.
 */
export function parseEmailSearchFilters(
  query: Record<string, string | undefined>,
): EmailSearchFilters | undefined {
  const size = Number(query.sizeBytes);
  const sizeOp = query.sizeOp === 'gt' || query.sizeOp === 'lt' ? query.sizeOp : undefined;
  const within = WITHINS.includes(query.within as SearchWithin)
    ? (query.within as SearchWithin)
    : undefined;
  const scope = SCOPES.includes(query.scope as SearchScope)
    ? (query.scope as SearchScope)
    : undefined;

  const filters: EmailSearchFilters = {
    from: clean(query.from),
    to: clean(query.to),
    subject: clean(query.subject),
    words: clean(query.words),
    notWords: clean(query.notWords),
    // A size operator without a number (or the reverse) filters nothing — both
    // halves have to be present or neither is kept.
    ...(sizeOp && Number.isFinite(size) && size > 0
      ? { sizeOp, sizeBytes: Math.floor(size) }
      : {}),
    within,
    anchor: /^\d{4}-\d{2}-\d{2}$/.test(query.anchor ?? '') ? query.anchor : undefined,
    hasAttachment: query.hasAttachment === 'true' || query.hasAttachment === '1',
    scope,
  };

  const meaningful =
    filters.from ??
    filters.to ??
    filters.subject ??
    filters.words ??
    filters.notWords ??
    filters.sizeBytes ??
    filters.within ??
    (filters.hasAttachment || undefined) ??
    // 'inbox' is the default view, so it alone is not a filter worth a search.
    (filters.scope && filters.scope !== 'inbox' ? filters.scope : undefined);

  return meaningful === undefined ? undefined : filters;
}

/** The [after, before] window a "date within" selection describes. */
export function withinRange(
  within: SearchWithin,
  anchor?: string,
): { after: Date; before: Date } {
  // Parse date-only as LOCAL midnight — `new Date('2026-08-23')` is UTC and would
  // shift the window by a day for anyone west of Greenwich.
  const centre = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
  const days = WITHIN_DAYS[within];
  const ms = days * 86400000;
  return { after: new Date(centre.getTime() - ms), before: new Date(centre.getTime() + ms) };
}

/** yyyy/mm/dd — the only date format Gmail's after:/before: accept unambiguously. */
function gmailDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Quote a value that will sit after a `field:` operator.
 *
 * Both query languages treat a space as a separator, so `subject:quarterly report`
 * would search the subject for "quarterly" and the body for "report".
 */
function quote(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

/**
 * Compile to Gmail search syntax and AND it with whatever the user typed free-hand.
 *
 * Returns undefined when there is nothing to search for, which keeps the caller on
 * the plain unfiltered listing path.
 */
export function buildGmailQuery(
  free: string | undefined,
  f: EmailSearchFilters | undefined,
): string | undefined {
  const parts: string[] = [];
  const freeText = clean(free);
  if (freeText) parts.push(freeText);

  if (f?.from) parts.push(`from:${quote(f.from)}`);
  if (f?.to) parts.push(`to:${quote(f.to)}`);
  if (f?.subject) parts.push(`subject:${quote(f.subject)}`);
  if (f?.words) parts.push(f.words);
  // Gmail negates a multi-word phrase as a unit only when it is quoted.
  if (f?.notWords) parts.push(`-${quote(f.notWords)}`);
  if (f?.sizeBytes) {
    parts.push(`${f.sizeOp === 'lt' ? 'smaller' : 'larger'}:${f.sizeBytes}`);
  }
  if (f?.within) {
    const { after, before } = withinRange(f.within, f.anchor);
    parts.push(`after:${gmailDate(after)}`, `before:${gmailDate(before)}`);
  }
  if (f?.hasAttachment) parts.push('has:attachment');
  // Scope is expressed through labelIds for every value except "all", which has no
  // label — it is the absence of one, minus the two folders Gmail's own All Mail
  // leaves out.
  if (f?.scope === 'all') parts.push('-in:spam', '-in:trash');

  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Compile to the KQL that Graph's `$search` understands.
 *
 * Note the caller's constraint: Graph forbids `$search` alongside `$orderby`, so a
 * searched list comes back relevance-ordered rather than newest-first.
 */
export function buildGraphSearch(
  free: string | undefined,
  f: EmailSearchFilters | undefined,
): string | undefined {
  const parts: string[] = [];
  const freeText = clean(free);
  if (freeText) parts.push(freeText);

  if (f?.from) parts.push(`from:${quote(f.from)}`);
  if (f?.to) parts.push(`to:${quote(f.to)}`);
  if (f?.subject) parts.push(`subject:${quote(f.subject)}`);
  if (f?.words) parts.push(f.words);
  if (f?.notWords) parts.push(`NOT(${quote(f.notWords)})`);
  if (f?.sizeBytes) {
    parts.push(`size${f.sizeOp === 'lt' ? '<' : '>'}${f.sizeBytes}`);
  }
  if (f?.within) {
    const { after, before } = withinRange(f.within, f.anchor);
    parts.push(`received>=${isoDate(after)}`, `received<=${isoDate(before)}`);
  }
  if (f?.hasAttachment) parts.push('hasAttachments:true');
  // No scope clause: Graph scopes by the mail folder in the URL, not in KQL.

  return parts.length > 0 ? parts.join(' AND ') : undefined;
}

/**
 * Fold the panel's scope into the label list the providers already understand.
 *
 * `all` becomes an empty list rather than a sentinel: Gmail then applies no label
 * filter (the query carries `-in:spam -in:trash` instead), and Microsoft's
 * `folderFor` needs an explicit case, which it has.
 */
export function resolveScopeLabels(
  labelIds: string[] | undefined,
  scope: SearchScope | undefined,
): string[] | undefined {
  if (!scope) return labelIds;
  switch (scope) {
    case 'all':
      return ['ALL'];
    case 'sent':
      return ['SENT'];
    case 'spam':
      return ['SPAM'];
    case 'trash':
      return ['TRASH'];
    case 'inbox':
    default:
      return ['INBOX'];
  }
}
