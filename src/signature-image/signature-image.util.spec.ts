import {
  MAX_LOGO_EDGE_PX,
  boundedSize,
  defaultImageName,
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
