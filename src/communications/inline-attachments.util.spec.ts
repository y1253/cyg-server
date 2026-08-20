import {
  isBodyEmbedded,
  normalizeContentId,
  referencedCidsFromHtml,
} from './inline-attachments.util.js';

describe('referencedCidsFromHtml', () => {
  it('collects every cid the body embeds', () => {
    const cids = referencedCidsFromHtml(
      '<img src="cid:logo@corp"><p>hi</p><img src=\'cid:shot-2.png\'>',
    );
    expect(cids.has('logo@corp')).toBe(true);
    expect(cids.has('shot-2.png')).toBe(true);
  });

  it('stores the percent-decoded form too, since senders differ', () => {
    const cids = referencedCidsFromHtml('<img src="cid:a%40b.com">');
    expect(cids.has('a%40b.com')).toBe(true);
    expect(cids.has('a@b.com')).toBe(true);
  });

  it('keeps a malformed escape as-is rather than throwing', () => {
    expect(() => referencedCidsFromHtml('<img src="cid:100%">')).not.toThrow();
    expect(referencedCidsFromHtml('<img src="cid:100%">').has('100%')).toBe(
      true,
    );
  });

  it('is empty for a missing or non-HTML body', () => {
    expect(referencedCidsFromHtml(null).size).toBe(0);
    expect(referencedCidsFromHtml(undefined).size).toBe(0);
    expect(referencedCidsFromHtml('plain text, no images').size).toBe(0);
  });
});

describe('normalizeContentId', () => {
  it('strips the angle brackets a raw Content-ID header carries', () => {
    expect(normalizeContentId('<abc@mail>')).toBe('abc@mail');
  });

  it('passes through an already-bare id', () => {
    expect(normalizeContentId('abc@mail')).toBe('abc@mail');
  });

  it('treats missing or empty as no Content-ID', () => {
    expect(normalizeContentId(null)).toBeNull();
    expect(normalizeContentId(undefined)).toBeNull();
    expect(normalizeContentId('   ')).toBeNull();
    expect(normalizeContentId('<>')).toBeNull();
  });
});

describe('isBodyEmbedded', () => {
  const body = '<img src="cid:logo@corp">';

  it('is true only when the body actually references the Content-ID', () => {
    const cids = referencedCidsFromHtml(body);
    expect(isBodyEmbedded('<logo@corp>', cids)).toBe(true);
  });

  // The regression this whole change exists for: a pasted screenshot arrives with
  // Content-Disposition: inline and a Content-ID the body never references. It
  // used to be classified inline, which hid it from the attachment strip while
  // nothing rendered it in the body either.
  it('is false for an unreferenced Content-ID, however the part was labelled', () => {
    const cids = referencedCidsFromHtml(body);
    expect(isBodyEmbedded('<screenshot-2026.png@mail>', cids)).toBe(false);
  });

  it('is false when the part has no Content-ID at all', () => {
    expect(isBodyEmbedded(null, referencedCidsFromHtml(body))).toBe(false);
  });

  it('is false when the body is absent', () => {
    expect(isBodyEmbedded('<logo@corp>', referencedCidsFromHtml(null))).toBe(
      false,
    );
  });
});
