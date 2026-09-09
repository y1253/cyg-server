import {
  HARDCODED_FALLBACK,
  SEED_DEFAULTS,
  SIGNATURE_FIELDS,
  imageIdOrNone,
  resolveSignature,
} from './email-signature.util';

const GLOBAL = {
  signatureHtml: '<div>{company name}</div>',
  signatureImageId: 7,
};

describe('resolveSignature', () => {
  it('falls back to the built-in signature when there is no global row', () => {
    expect(resolveSignature(null, null).effective).toEqual(HARDCODED_FALLBACK);
  });

  it('inherits every field when the company has no overrides', () => {
    const { effective, source } = resolveSignature(GLOBAL, null);
    expect(effective).toEqual(GLOBAL);
    expect(source).toEqual({
      signatureHtml: 'default',
      signatureImageId: 'default',
    });
  });

  it('lets an override win', () => {
    const { effective, source } = resolveSignature(GLOBAL, {
      signatureHtml: '<div>Custom</div>',
    });
    expect(effective.signatureHtml).toBe('<div>Custom</div>');
    expect(source.signatureHtml).toBe('company');
    // Untouched field still inherits.
    expect(effective.signatureImageId).toBe(7);
    expect(source.signatureImageId).toBe('default');
  });

  // ── The `??` vs `||` guard. Both of these are values an admin chose. ───────
  it('keeps an EMPTY signature override — "" means send none, not "inherit"', () => {
    const { effective, source } = resolveSignature(GLOBAL, {
      signatureHtml: '',
    });
    expect(effective.signatureHtml).toBe('');
    expect(source.signatureHtml).toBe('company');
  });

  it('keeps a ZERO image override — 0 means no logo, not "inherit"', () => {
    const { effective, source } = resolveSignature(GLOBAL, {
      signatureImageId: 0,
    });
    expect(effective.signatureImageId).toBe(0);
    expect(source.signatureImageId).toBe('company');
  });

  it('treats an explicit null as inherit', () => {
    const { effective, source } = resolveSignature(GLOBAL, {
      signatureHtml: null,
      signatureImageId: null,
    });
    expect(effective).toEqual(GLOBAL);
    expect(source.signatureHtml).toBe('default');
  });
});

describe('the shipped defaults', () => {
  it('ships a non-empty signature, so a settings outage does not silently unsign mail', () => {
    expect(HARDCODED_FALLBACK.signatureHtml.length).toBeGreaterThan(0);
    expect(HARDCODED_FALLBACK).toBe(SEED_DEFAULTS);
  });

  it('carries the tokens the old hardcoded builder read off a company', () => {
    expect(SEED_DEFAULTS.signatureHtml).toContain('{company name}');
    expect(SEED_DEFAULTS.signatureHtml).toContain('{support number}');
    expect(SEED_DEFAULTS.signatureHtml).toContain('{billing email}');
    // And the two literals it hardcoded, now editable.
    expect(SEED_DEFAULTS.signatureHtml).toContain('Accounting Department');
    expect(SEED_DEFAULTS.signatureHtml).toContain('CYG FINANCE');
  });

  it('ships with no logo', () => {
    expect(SEED_DEFAULTS.signatureImageId).toBe(0);
  });

  it('has a field list covering every field the resolver returns', () => {
    expect([...SIGNATURE_FIELDS].sort()).toEqual(
      Object.keys(SEED_DEFAULTS).sort(),
    );
  });
});

describe('imageIdOrNone', () => {
  it('reads 0 as "none", not as an id', () => {
    expect(imageIdOrNone(0)).toBeNull();
  });

  it('reads null and undefined as none', () => {
    expect(imageIdOrNone(null)).toBeNull();
    expect(imageIdOrNone(undefined)).toBeNull();
  });

  it('rejects a negative id', () => {
    expect(imageIdOrNone(-3)).toBeNull();
  });

  it('passes a real id through', () => {
    expect(imageIdOrNone(7)).toBe(7);
  });
});
