import { documentKind } from './document-kind.util.js';

describe('documentKind', () => {
  it('reads the ordinary cases', () => {
    expect(documentKind('application/pdf', 'invoice.pdf')).toEqual({
      kind: 'pdf',
    });
    expect(documentKind('image/jpeg', 'receipt.jpg')).toEqual({
      kind: 'image',
    });
    expect(documentKind('text/csv', 'ledger.csv')).toEqual({ kind: 'text' });
  });

  /**
   * The mime type is client-supplied, so a special-cased kind has to be CONFIRMED by the
   * extension rather than merely left uncontradicted by it — `whatsappMediaKind`'s rule.
   */
  it('refuses a type the filename contradicts', () => {
    const out = documentKind('image/png', 'payload.exe');
    expect(out).toHaveProperty('refuse');
  });

  it('judges an extensionless file on its declared type, for pasted screenshots', () => {
    expect(documentKind('image/png', 'image')).toEqual({ kind: 'image' });
  });

  /**
   * Refusing up front with a sentence somebody can act on beats letting it die inside a
   * decoder and surfacing as something untrue — the `isMmsImage`/HEIC argument.
   */
  it('names the older Office formats rather than saying "unsupported"', () => {
    const out = documentKind('application/msword', 'letter.doc');
    expect(out).toHaveProperty('refuse');
    if ('refuse' in out) expect(out.refuse).toMatch(/PDF/);
  });

  it('refuses anything it has no decoder for', () => {
    expect(documentKind('application/zip', 'bundle.zip')).toHaveProperty(
      'refuse',
    );
    expect(documentKind('image/heic', 'photo.heic')).toHaveProperty('refuse');
    expect(documentKind('audio/mpeg', 'note.mp3')).toHaveProperty('refuse');
  });

  it('trusts a .pdf name even when the declared type is vague', () => {
    expect(documentKind('application/octet-stream', 'statement.pdf')).toEqual({
      kind: 'pdf',
    });
  });
});
