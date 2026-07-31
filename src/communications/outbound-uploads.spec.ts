import { INLINE_BUDGET_BYTES, splitBySizeBudget } from './outbound-uploads';

const MB = 1024 * 1024;

/** Minimal stand-in for a multer file — the split only reads `size`. */
const file = (name: string, mb: number) => ({ name, size: Math.round(mb * MB) });

describe('splitBySizeBudget', () => {
  it('keeps everything inline when the total fits', () => {
    const files = [file('a', 1), file('b', 2), file('c', 3)];
    const { inline, linked } = splitBySizeBudget(files);
    expect(inline).toEqual(files);
    expect(linked).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(splitBySizeBudget([])).toEqual({ inline: [], linked: [] });
  });

  it('links a single file that is bigger than the budget on its own', () => {
    const big = file('video', 60);
    const { inline, linked } = splitBySizeBudget([big]);
    expect(inline).toEqual([]);
    expect(linked).toEqual([big]);
  });

  it('spills the largest file and keeps the small ones attached', () => {
    const pdf = file('report.pdf', 1);
    const video = file('clip.mp4', 60);
    const img = file('logo.png', 0.5);
    const { inline, linked } = splitBySizeBudget([pdf, video, img]);
    expect(linked).toEqual([video]);
    expect(inline).toEqual([pdf, img]);
  });

  it('spills largest-first until the remainder fits', () => {
    // 12 + 11 + 2 = 25 MB against an 18 MB budget: dropping only the 12 still
    // leaves 13 MB, which fits — so exactly one file should move.
    const a = file('a', 12);
    const b = file('b', 11);
    const c = file('c', 2);
    const { inline, linked } = splitBySizeBudget([a, b, c]);
    expect(linked).toEqual([a]);
    expect(inline).toEqual([b, c]);
    const inlineTotal = inline.reduce((n, f) => n + f.size, 0);
    expect(inlineTotal).toBeLessThanOrEqual(INLINE_BUDGET_BYTES);
  });

  it('spills more than one file when a single spill is not enough', () => {
    const files = [file('a', 10), file('b', 10), file('c', 10)];
    const { inline, linked } = splitBySizeBudget(files);
    expect(linked).toHaveLength(2);
    expect(inline).toHaveLength(1);
    expect(inline[0].size).toBeLessThanOrEqual(INLINE_BUDGET_BYTES);
  });

  it('preserves the original order within each list', () => {
    const files = [file('a', 30), file('b', 1), file('c', 40), file('d', 1)];
    const { inline, linked } = splitBySizeBudget(files);
    expect(inline.map((f) => f.name)).toEqual(['b', 'd']);
    expect(linked.map((f) => f.name)).toEqual(['a', 'c']);
  });

  it('breaks size ties by original order, so the result is deterministic', () => {
    const files = [file('first', 10), file('second', 10)];
    const { linked } = splitBySizeBudget(files);
    expect(linked.map((f) => f.name)).toEqual(['first']);
  });

  it('respects an explicit budget', () => {
    const files = [file('a', 2), file('b', 2)];
    expect(splitBySizeBudget(files, 3 * MB).linked).toHaveLength(1);
    expect(splitBySizeBudget(files, 4 * MB).linked).toHaveLength(0);
  });
});
