import { insertAboveQuote } from './draft-body.util.js';

describe('insertAboveQuote', () => {
  const draft =
    '<html><head><style>.q { color: red }</style></head>' +
    '<body class="x"><div class="q">quoted original</div></body></html>';

  it('splices the user body directly after <body>, above the quote', () => {
    const out = insertAboveQuote('<p>my reply</p>', draft);
    expect(out).toContain('<body class="x"><p>my reply</p><div class="q">');
    expect(out.indexOf('my reply')).toBeLessThan(
      out.indexOf('quoted original'),
    );
  });

  it('preserves the <head><style> that formats the quote', () => {
    const out = insertAboveQuote('<p>hi</p>', draft);
    expect(out).toContain('<style>.q { color: red }</style>');
  });

  it('keeps the quoted original intact', () => {
    expect(insertAboveQuote('<p>hi</p>', draft)).toContain('quoted original');
  });

  it('matches <body> regardless of attributes or casing', () => {
    const out = insertAboveQuote('<p>hi</p>', '<BODY dir="ltr">q</BODY>');
    expect(out).toBe('<BODY dir="ltr"><p>hi</p>q</BODY>');
  });

  it('falls back to concatenation when there is no <body> tag', () => {
    expect(insertAboveQuote('<p>hi</p>', '<div>q</div>')).toBe(
      '<p>hi</p><br><div>q</div>',
    );
  });

  it('returns the user body when the draft is empty', () => {
    expect(insertAboveQuote('<p>hi</p>', '')).toBe('<p>hi</p>');
  });

  it('returns the draft untouched when the user body is empty', () => {
    expect(insertAboveQuote('', draft)).toBe(draft);
  });
});
