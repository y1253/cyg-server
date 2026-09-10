import {
  MAX_LOGO_EDGE_PX,
  boundedSize,
  defaultImageName,
  imageScopeWhere,
  isImageInLibrary,
  isImageVisibleTo,
  type ImageScope,
} from './signature-image.util';

describe('boundedSize', () => {
  it('leaves an already-small image untouched, so re-encoding is idempotent', () => {
    expect(boundedSize({ width: 200, height: 80 })).toEqual({
      width: 200,
      height: 80,
    });
  });

  it('never upscales — a small logo must not have detail invented for it', () => {
    const out = boundedSize({ width: 40, height: 40 });
    expect(out).toEqual({ width: 40, height: 40 });
  });

  it('shrinks the longest edge to the bound', () => {
    const out = boundedSize({ width: 3000, height: 1500 });
    expect(Math.max(out.width, out.height)).toBe(MAX_LOGO_EDGE_PX);
  });

  it('preserves aspect ratio', () => {
    const out = boundedSize({ width: 3000, height: 1500 });
    expect(out.width / out.height).toBeCloseTo(2, 5);
  });

  it('bounds by HEIGHT when the image is tall', () => {
    const out = boundedSize({ width: 500, height: 4000 });
    expect(out.height).toBe(MAX_LOGO_EDGE_PX);
    expect(out.width).toBeLessThan(MAX_LOGO_EDGE_PX);
  });

  it('never rounds an edge to zero on an extreme aspect ratio', () => {
    // sharp rejects a zero dimension outright, so this is a real failure, not a nicety.
    const out = boundedSize({ width: 6000, height: 3 });
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe('defaultImageName', () => {
  it('drops the extension', () => {
    expect(defaultImageName('acme-logo.png')).toBe('acme-logo');
  });

  it('drops any directory the browser included', () => {
    expect(defaultImageName('C:\\pics\\acme.png')).toBe('acme');
  });

  it('falls back rather than returning an empty label', () => {
    expect(defaultImageName('.png')).toBe('Untitled');
    expect(defaultImageName('')).toBe('Untitled');
  });

  it('caps a very long name', () => {
    expect(defaultImageName('a'.repeat(500) + '.png')).toHaveLength(80);
  });
});

// The whole scoping rule, as a table. Both predicates answer over the same four
// (image, scope) pairs, and the interesting part is where they DISAGREE.
const CASES: {
  image: ImageScope;
  scope: ImageScope;
  visible: boolean;
  editable: boolean;
  why: string;
}[] = [
  {
    image: null,
    scope: null,
    visible: true,
    editable: true,
    why: 'the firm-wide library managing its own logo',
  },
  {
    image: null,
    scope: 7,
    visible: true,
    editable: false,
    why: 'a company may USE a firm-wide logo but never edit one',
  },
  {
    image: 7,
    scope: 7,
    visible: true,
    editable: true,
    why: "a company's own logo",
  },
  {
    image: 7,
    scope: 8,
    visible: false,
    editable: false,
    why: "another company's logo is not even visible",
  },
  {
    image: 7,
    scope: null,
    visible: false,
    editable: false,
    why: 'a company logo can never become the firm-wide default',
  },
];

describe('isImageVisibleTo / isImageInLibrary', () => {
  it.each(CASES)(
    'image=$image scope=$scope — $why',
    ({ image, scope, visible, editable }) => {
      expect(isImageVisibleTo(image, scope)).toBe(visible);
      expect(isImageInLibrary(image, scope)).toBe(editable);
    },
  );

  it('editable always implies visible', () => {
    // The gap between the two is deliberate, but it only ever runs one way: nothing may be
    // editable without being visible. A future edit that widened `isImageInLibrary` would
    // break here rather than silently granting write access to something unlistable.
    for (const { image, scope } of CASES) {
      if (isImageInLibrary(image, scope)) {
        expect(isImageVisibleTo(image, scope)).toBe(true);
      }
    }
  });
});

describe('imageScopeWhere', () => {
  it('asks for firm-wide rows ONLY, with no OR, when the scope is firm-wide', () => {
    // The leak test. An `OR` here would put every company's private logo into the
    // admin library and into the firm-wide default's picker.
    const where = imageScopeWhere(null);
    expect(where).toEqual({ companyId: null });
    expect(where).not.toHaveProperty('OR');
  });

  it('asks for firm-wide plus exactly this company', () => {
    expect(imageScopeWhere(7)).toEqual({
      OR: [{ companyId: null }, { companyId: 7 }],
    });
  });

  it('agrees with isImageVisibleTo on every case in the table', () => {
    // The `where` and the predicate are two statements of one rule; this is what stops
    // them drifting. Reading the clause back is enough — it is a two-branch shape.
    for (const { image, scope, visible } of CASES) {
      const where = imageScopeWhere(scope);
      const clauses = where.OR ?? [{ companyId: where.companyId ?? null }];
      const accepted = clauses.some((clause) => clause.companyId === image);
      expect(accepted).toBe(visible);
    }
  });
});
