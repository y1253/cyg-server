import { decodeHtmlEntities, fromDisplayName } from './preview.util.js';

describe('decodeHtmlEntities', () => {
  it('decodes what Gmail actually escapes in a snippet', () => {
    expect(decodeHtmlEntities('Bob&#39;s invoice &amp; receipt')).toBe(
      "Bob's invoice & receipt",
    );
    expect(decodeHtmlEntities('&lt;draft&gt; &quot;final&quot;')).toBe(
      '<draft> "final"',
    );
  });

  it('does not revive an entity hidden behind an escaped ampersand', () => {
    // "&amp;lt;" is a literal "&lt;", not a "<".
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });

  it('leaves plain text alone', () => {
    expect(decodeHtmlEntities('Just a normal line.')).toBe(
      'Just a normal line.',
    );
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('fromDisplayName', () => {
  it('prefers the display name', () => {
    expect(fromDisplayName('Jane Doe <j@x.com>')).toBe('Jane Doe');
  });

  it('unquotes a name containing a comma', () => {
    expect(fromDisplayName('"Doe, Jane" <j@x.com>')).toBe('Doe, Jane');
  });

  it('unescapes inside a quoted name', () => {
    expect(fromDisplayName('"Jane \\"JD\\" Doe" <j@x.com>')).toBe(
      'Jane "JD" Doe',
    );
  });

  it('falls back to the address when there is no name', () => {
    expect(fromDisplayName('<j@x.com>')).toBe('j@x.com');
    expect(fromDisplayName('j@x.com')).toBe('j@x.com');
  });

  it('handles an empty or whitespace header', () => {
    expect(fromDisplayName('')).toBe('');
    expect(fromDisplayName('   ')).toBe('');
  });

  it('keeps an address containing an angle bracket in the display name', () => {
    expect(fromDisplayName('Support <help@x.com>')).toBe('Support');
  });
});
