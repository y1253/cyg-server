import {
  buildGmailQuery,
  buildGraphSearch,
  parseEmailSearchFilters,
  resolveScopeLabels,
  withinRange,
} from './email-search.js';

describe('parseEmailSearchFilters', () => {
  it('returns undefined when nothing usable was supplied', () => {
    expect(parseEmailSearchFilters({})).toBeUndefined();
    expect(parseEmailSearchFilters({ from: '   ', subject: '' })).toBeUndefined();
  });

  it('does not treat the default inbox scope as a filter on its own', () => {
    expect(parseEmailSearchFilters({ scope: 'inbox' })).toBeUndefined();
    expect(parseEmailSearchFilters({ scope: 'sent' })?.scope).toBe('sent');
  });

  it('keeps a size filter only when operator and number are both present', () => {
    expect(parseEmailSearchFilters({ sizeOp: 'gt' })).toBeUndefined();
    expect(parseEmailSearchFilters({ sizeBytes: '5000' })).toBeUndefined();
    const both = parseEmailSearchFilters({ sizeOp: 'gt', sizeBytes: '5000' });
    expect(both).toMatchObject({ sizeOp: 'gt', sizeBytes: 5000 });
  });

  // A bad value must degrade to "no filter", never to a 400 — a partly-understood
  // search still returns useful mail.
  it('drops unparseable values instead of throwing', () => {
    expect(parseEmailSearchFilters({ sizeOp: 'nonsense', sizeBytes: 'abc' })).toBeUndefined();
    expect(parseEmailSearchFilters({ within: 'someday', from: 'a' })?.within).toBeUndefined();
    expect(parseEmailSearchFilters({ scope: 'archive', from: 'a' })?.scope).toBeUndefined();
    expect(parseEmailSearchFilters({ anchor: '23/08/2026', from: 'a' })?.anchor).toBeUndefined();
  });

  it('accepts either checkbox encoding for hasAttachment', () => {
    expect(parseEmailSearchFilters({ hasAttachment: 'true' })?.hasAttachment).toBe(true);
    expect(parseEmailSearchFilters({ hasAttachment: '1' })?.hasAttachment).toBe(true);
    expect(parseEmailSearchFilters({ hasAttachment: 'false' })).toBeUndefined();
  });
});

describe('withinRange', () => {
  it('centres the window on the anchor date', () => {
    const { after, before } = withinRange('1w', '2026-08-20');
    expect(after.getFullYear()).toBe(2026);
    expect(after.getMonth()).toBe(7); // August
    expect(after.getDate()).toBe(13);
    expect(before.getDate()).toBe(27);
  });

  // `new Date('2026-08-20')` parses as UTC midnight, which is the previous day
  // for anyone west of Greenwich — the window would silently shift.
  it('treats the anchor as a local date, not UTC', () => {
    const { after } = withinRange('1d', '2026-08-20');
    expect(after.getDate()).toBe(19);
  });
});

describe('buildGmailQuery', () => {
  it('returns undefined when there is nothing to search', () => {
    expect(buildGmailQuery(undefined, undefined)).toBeUndefined();
    expect(buildGmailQuery('   ', undefined)).toBeUndefined();
  });

  it('passes free text through untouched', () => {
    expect(buildGmailQuery('invoice', undefined)).toBe('invoice');
  });

  it('builds Gmail operator syntax', () => {
    const q = buildGmailQuery(undefined, {
      from: 'bob@x.com',
      subject: 'Q3 filing',
      hasAttachment: true,
      sizeOp: 'gt',
      sizeBytes: 5242880,
    });
    expect(q).toContain('from:"bob@x.com"');
    // Quoted because a bare `subject:Q3 filing` would search the body for "filing".
    expect(q).toContain('subject:"Q3 filing"');
    expect(q).toContain('has:attachment');
    expect(q).toContain('larger:5242880');
  });

  it('uses smaller: for a less-than size', () => {
    expect(buildGmailQuery(undefined, { sizeOp: 'lt', sizeBytes: 1000 })).toContain(
      'smaller:1000',
    );
  });

  it('negates a multi-word exclusion as one phrase', () => {
    expect(buildGmailQuery(undefined, { notWords: 'out of office' })).toBe(
      '-"out of office"',
    );
  });

  it('excludes spam and trash for the All Mail scope, matching Gmail', () => {
    const q = buildGmailQuery(undefined, { scope: 'all', from: 'a@b.com' });
    expect(q).toContain('-in:spam');
    expect(q).toContain('-in:trash');
  });

  it('combines free text with the filters', () => {
    expect(buildGmailQuery('receipt', { from: 'bob@x.com' })).toBe(
      'receipt from:"bob@x.com"',
    );
  });

  it('emits a bounded date window', () => {
    const q = buildGmailQuery(undefined, { within: '1w', anchor: '2026-08-20' });
    expect(q).toBe('after:2026/8/13 before:2026/8/27');
  });
});

describe('buildGraphSearch', () => {
  it('builds KQL, not Gmail syntax', () => {
    const q = buildGraphSearch(undefined, {
      from: 'bob@x.com',
      hasAttachment: true,
      sizeOp: 'gt',
      sizeBytes: 5242880,
      notWords: 'newsletter',
    });
    expect(q).toContain('from:"bob@x.com"');
    expect(q).toContain('hasAttachments:true');
    expect(q).toContain('size>5242880');
    expect(q).toContain('NOT("newsletter")');
    expect(q).toContain(' AND ');
    // Gmail-only spellings must never leak into a Graph query.
    expect(q).not.toContain('larger:');
    expect(q).not.toContain('has:attachment ');
  });

  it('scopes by folder in the URL, so no scope clause appears in the query', () => {
    expect(buildGraphSearch(undefined, { scope: 'all', from: 'a@b.com' })).toBe(
      'from:"a@b.com"',
    );
  });

  it('emits an ISO date window', () => {
    const q = buildGraphSearch(undefined, { within: '1d', anchor: '2026-08-20' });
    expect(q).toContain('received>=2026-08-19');
    expect(q).toContain('received<=2026-08-21');
  });
});

describe('resolveScopeLabels', () => {
  it('leaves the caller labels alone when no scope is chosen', () => {
    expect(resolveScopeLabels(['UNREAD'], undefined)).toEqual(['UNREAD']);
    expect(resolveScopeLabels(undefined, undefined)).toBeUndefined();
  });

  it('maps each scope to the label both providers understand', () => {
    expect(resolveScopeLabels(undefined, 'all')).toEqual(['ALL']);
    expect(resolveScopeLabels(undefined, 'sent')).toEqual(['SENT']);
    expect(resolveScopeLabels(undefined, 'spam')).toEqual(['SPAM']);
    expect(resolveScopeLabels(undefined, 'trash')).toEqual(['TRASH']);
    expect(resolveScopeLabels(undefined, 'inbox')).toEqual(['INBOX']);
  });
});
