import {
  BOX_MIN_W,
  CROP_MARGIN,
  GAIN_MAX,
  MIN_SIDE,
  NO_BOX_MAX_EDGE,
  TARGET_SIDE,
  TONE_MEAN_HIGH,
  TONE_MEAN_LOW,
  TONE_STDEV_LOW,
  TONE_TARGET_MEAN,
  TONE_TARGET_STDEV,
  cropRect,
  jpegQuality,
  lumaStats,
  needsDenoise,
  noBoxResize,
  parseFaceBox,
  parseFaceBoxes,
  resizeKernel,
  sharpenParams,
  targetSide,
  toneAdjustment,
  type LumaStats,
} from './face-image.js';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('parseFaceBox', () => {
  // The governing rule: a stale or broken client must lose the crop, never the
  // ability to log in. Every rejection below has to be a null, not a throw.
  it('parses a well-formed JSON string', () => {
    expect(parseFaceBox('{"x":0.31,"y":0.18,"w":0.29,"h":0.36}')).toEqual(
      box(0.31, 0.18, 0.29, 0.36),
    );
  });

  it('accepts an already-parsed object', () => {
    expect(parseFaceBox(box(0.3, 0.2, 0.3, 0.3))).toEqual(
      box(0.3, 0.2, 0.3, 0.3),
    );
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(() => parseFaceBox('{"x":0.3,')).not.toThrow();
    expect(parseFaceBox('{"x":0.3,')).toBeNull();
  });

  it('returns null for a missing or empty field', () => {
    expect(parseFaceBox(undefined)).toBeNull();
    expect(parseFaceBox(null)).toBeNull();
    expect(parseFaceBox('')).toBeNull();
  });

  it('returns null for an array', () => {
    expect(parseFaceBox('[0.3,0.2,0.3,0.3]')).toBeNull();
  });

  it('coerces numeric strings', () => {
    expect(parseFaceBox('{"x":"0.3","y":"0.2","w":"0.3","h":"0.3"}')).toEqual(
      box(0.3, 0.2, 0.3, 0.3),
    );
  });

  it('ignores extra keys', () => {
    expect(
      parseFaceBox({ x: 0.3, y: 0.2, w: 0.3, h: 0.3, score: 0.9 }),
    ).toEqual(box(0.3, 0.2, 0.3, 0.3));
  });

  it('rejects non-finite values', () => {
    expect(parseFaceBox({ x: NaN, y: 0.2, w: 0.3, h: 0.3 })).toBeNull();
    expect(parseFaceBox({ x: 0.3, y: 0.2, w: Infinity, h: 0.3 })).toBeNull();
    expect(parseFaceBox({ x: 0.3, y: null, w: 0.3, h: 0.3 })).toBeNull();
    expect(parseFaceBox({ x: 0.3, y: 0.2, w: 0.3 })).toBeNull();
  });

  it('rejects a zero or negative box', () => {
    expect(parseFaceBox(box(0.3, 0.2, 0, 0.3))).toBeNull();
    expect(parseFaceBox(box(0.3, 0.2, 0.3, -0.1))).toBeNull();
  });

  // MediaPipe computes these by division and a face at the frame border routinely
  // lands a hair outside it. Rejecting that would drop the crop for exactly the
  // off-centre users we are trying to help.
  it('accepts a hair outside the frame and clamps it back in', () => {
    expect(parseFaceBox(box(-0.005, -0.004, 0.3, 0.3))).toEqual(
      box(0, 0, 0.3, 0.3),
    );
  });

  it('rejects a box genuinely outside the frame', () => {
    expect(parseFaceBox(box(-0.2, 0.2, 0.3, 0.3))).toBeNull();
    expect(parseFaceBox(box(0.8, 0.2, 0.3, 0.3))).toBeNull();
  });

  it('rejects a box too small to be a real face', () => {
    expect(parseFaceBox(box(0.4, 0.4, BOX_MIN_W - 0.001, 0.1))).toBeNull();
  });

  // Not an error — there is simply no background left to crop away.
  it('returns null for a box covering nearly the whole frame', () => {
    expect(parseFaceBox(box(0.02, 0.02, 0.95, 0.95))).toBeNull();
  });
});

describe('parseFaceBoxes', () => {
  it('always returns exactly `count` entries', () => {
    expect(parseFaceBoxes(undefined, 3)).toEqual([null, null, null]);
    expect(parseFaceBoxes('not json', 3)).toEqual([null, null, null]);
    expect(parseFaceBoxes('{"x":0.3}', 3)).toEqual([null, null, null]);
  });

  // One bad photo in an enrolment must not cost the other two their crop.
  it('keeps entries index-aligned, nulling only the bad ones', () => {
    const parsed = parseFaceBoxes(
      JSON.stringify([box(0.3, 0.2, 0.3, 0.3), null, box(0.4, 0.3, 0.2, 0.25)]),
      3,
    );
    expect(parsed[0]).toEqual(box(0.3, 0.2, 0.3, 0.3));
    expect(parsed[1]).toBeNull();
    expect(parsed[2]).toEqual(box(0.4, 0.3, 0.2, 0.25));
  });

  it('pads a short array', () => {
    expect(
      parseFaceBoxes(JSON.stringify([box(0.3, 0.2, 0.3, 0.3)]), 3),
    ).toHaveLength(3);
  });
});

describe('cropRect', () => {
  it('centres on the box and applies the margin', () => {
    const rect = cropRect(box(0.4, 0.4, 0.2, 0.2), 1000, 1000)!;
    // 0.2 * 1000 * 1.8
    expect(rect.width).toBe(360);
    expect(rect.height).toBe(360);
    expect(rect.left).toBe(500 - 180);
  });

  it('biases the crop centre upward', () => {
    const rect = cropRect(box(0.4, 0.4, 0.2, 0.2), 1000, 1000)!;
    const unbiased = 500 - 180;
    expect(rect.top).toBeLessThan(unbiased);
    expect(rect.top).toBe(Math.round(500 - 0.06 * 200 - 180));
  });

  // The alternative — shrinking the square — would strip context from a face that
  // has plenty of it on the other side.
  it('shifts the square inward for an edge face rather than shrinking it', () => {
    const rect = cropRect(box(0, 0.4, 0.2, 0.2), 1000, 1000)!;
    expect(rect.left).toBe(0);
    expect(rect.width).toBe(360);
  });

  it('shrinks only when the expanded square exceeds the short edge', () => {
    const rect = cropRect(box(0.2, 0.1, 0.45, 0.45), 1280, 400)!;
    expect(rect.height).toBe(400);
    expect(rect.width).toBe(400);
  });

  it('returns integers', () => {
    const rect = cropRect(box(0.317, 0.183, 0.286, 0.361), 1281, 721)!;
    for (const v of [rect.left, rect.top, rect.width, rect.height]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('returns null when the crop would cover almost the whole frame', () => {
    expect(cropRect(box(0.05, 0.05, 0.85, 0.85), 1000, 1000)).toBeNull();
  });

  it('returns null for a degenerate image size', () => {
    expect(cropRect(box(0.3, 0.3, 0.3, 0.3), 0, 720)).toBeNull();
  });

  // This sweep is the test that prevents a production `extract_area: bad extract
  // area`. sharp throws on a rect even one pixel outside the image, and the
  // rounding at the end of cropRect is exactly where that pixel comes from.
  it('never produces a rect outside the image, for any box on any frame', () => {
    const sizes: [number, number][] = [
      [320, 240],
      [640, 480],
      [1280, 720],
      [1920, 1080],
      [720, 720],
      [480, 640],
      [1281, 721],
    ];
    for (const [imgW, imgH] of sizes) {
      for (let x = 0; x <= 0.8; x += 0.05) {
        for (let y = 0; y <= 0.8; y += 0.05) {
          for (const w of [0.06, 0.15, 0.28, 0.45, 0.7]) {
            for (const h of [0.08, 0.2, 0.36, 0.6]) {
              if (x + w > 1 || y + h > 1) continue;
              const rect = cropRect(box(x, y, w, h), imgW, imgH);
              if (rect === null) continue;
              expect(rect.width).toBeGreaterThan(0);
              expect(rect.height).toBeGreaterThan(0);
              expect(rect.left).toBeGreaterThanOrEqual(0);
              expect(rect.top).toBeGreaterThanOrEqual(0);
              expect(rect.left + rect.width).toBeLessThanOrEqual(imgW);
              expect(rect.top + rect.height).toBeLessThanOrEqual(imgH);
            }
          }
        }
      }
    }
  });

  it('uses CROP_MARGIN, not the raw box', () => {
    const rect = cropRect(box(0.4, 0.4, 0.1, 0.1), 1000, 1000)!;
    expect(rect.width).toBe(Math.round(100 * CROP_MARGIN));
  });
});

describe('targetSide', () => {
  it('upscales a small crop toward the target', () => {
    expect(targetSide(400).side).toBe(TARGET_SIDE);
    expect(targetSide(400).upscaled).toBe(true);
  });

  // Beyond 2x we would be inventing detail, so a 200px crop stops at 400 rather
  // than being stretched to 576.
  it('refuses to exceed MAX_UPSCALE', () => {
    expect(targetSide(200).side).toBe(400);
  });

  it('downscales a large crop to the target', () => {
    expect(targetSide(900).side).toBe(TARGET_SIDE);
    expect(targetSide(900).upscaled).toBe(false);
  });

  it('never drops below MIN_SIDE', () => {
    expect(targetSide(60).side).toBe(MIN_SIDE);
  });

  it('flips `upscaled` at the boundary', () => {
    expect(targetSide(TARGET_SIDE).upscaled).toBe(false);
    expect(targetSide(TARGET_SIDE - 1).upscaled).toBe(true);
  });
});

describe('noBoxResize', () => {
  it('returns null when the frame is already small enough', () => {
    expect(noBoxResize(1280, 720)).toBeNull();
    expect(noBoxResize(640, 480)).toBeNull();
  });

  it('downscales the long edge and preserves aspect', () => {
    expect(noBoxResize(1920, 1080)).toEqual({
      width: NO_BOX_MAX_EDGE,
      height: 720,
    });
  });

  it('handles a portrait frame', () => {
    expect(noBoxResize(1080, 1920)).toEqual({
      width: 720,
      height: NO_BOX_MAX_EDGE,
    });
  });
});

describe('resizeKernel', () => {
  it('avoids lanczos ringing when enlarging', () => {
    expect(resizeKernel(true)).toBe('mitchell');
    expect(resizeKernel(false)).toBe('lanczos3');
  });
});

// ── lumaStats ────────────────────────────────────────────────────────────────

/** Builds a raw RGB buffer from a per-pixel colour function. */
function rgb(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number],
  channels = 3,
): Buffer {
  const buf = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * channels;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      if (channels === 4) buf[i + 3] = 255;
    }
  }
  return buf;
}

describe('lumaStats', () => {
  it('measures a black frame', () => {
    const s = lumaStats(
      rgb(8, 8, () => [0, 0, 0]),
      8,
      8,
      3,
    );
    expect(s.mean).toBeCloseTo(0);
    expect(s.stdev).toBeCloseTo(0);
  });

  it('measures a flat mid-grey frame', () => {
    const s = lumaStats(
      rgb(8, 8, () => [128, 128, 128]),
      8,
      8,
      3,
    );
    expect(s.mean).toBeCloseTo(128);
    expect(s.stdev).toBeCloseTo(0);
  });

  it('measures a half-black half-white frame', () => {
    const s = lumaStats(
      rgb(8, 8, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255])),
      8,
      8,
      3,
    );
    expect(s.mean).toBeCloseTo(127.5);
    expect(s.stdev).toBeCloseTo(127.5);
  });

  // Pins the Rec.601 weighting. A naive (r+g+b)/3 would read 85 here, and would
  // silently disagree with the client's brightness gate.
  it('uses Rec.601 luma weights', () => {
    const s = lumaStats(
      rgb(4, 4, () => [0, 255, 0]),
      4,
      4,
      3,
    );
    expect(s.mean).toBeCloseTo(149.685, 2);
  });

  it('handles a 4-channel buffer', () => {
    const s = lumaStats(
      rgb(4, 4, () => [128, 128, 128], 4),
      4,
      4,
      4,
    );
    expect(s.mean).toBeCloseTo(128);
  });

  // The backlit case, tested directly: a dark face inside a bright frame. Measured
  // whole-frame it reads as well exposed, which is how a silhouette survives.
  it('region "center" ignores a bright border', () => {
    const dim = 16;
    const frame = rgb(dim, dim, (x, y) => {
      const inner = x >= 4 && x < 12 && y >= 4 && y < 12;
      return inner ? [40, 40, 40] : [250, 250, 250];
    });
    expect(lumaStats(frame, dim, dim, 3, 'all').mean).toBeGreaterThan(150);
    expect(lumaStats(frame, dim, dim, 3, 'center').mean).toBeCloseTo(40, 0);
  });

  it('reports zero Laplacian variance for a flat image and more for a busy one', () => {
    const flat = lumaStats(
      rgb(16, 16, () => [128, 128, 128]),
      16,
      16,
      3,
    );
    const busy = lumaStats(
      rgb(16, 16, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])),
      16,
      16,
      3,
    );
    expect(flat.laplacianVar).toBeCloseTo(0);
    expect(busy.laplacianVar).toBeGreaterThan(flat.laplacianVar);
  });

  it('does not divide by zero on a sub-3px region', () => {
    expect(
      lumaStats(
        rgb(2, 2, () => [10, 10, 10]),
        2,
        2,
        3,
      ).laplacianVar,
    ).toBe(0);
  });
});

// ── toneAdjustment ───────────────────────────────────────────────────────────

const stats = (mean: number, stdev: number, laplacianVar = 200): LumaStats => ({
  mean,
  stdev,
  laplacianVar,
});

describe('toneAdjustment', () => {
  // The guarantee behind "already-enrolled staff do not need to re-enrol": a
  // well-exposed face comes out of the pipeline untouched.
  it('leaves a well-exposed face alone', () => {
    expect(toneAdjustment(stats(128, 55))).toBeNull();
  });

  it('leaves the whole good band alone', () => {
    for (let mean = TONE_MEAN_LOW; mean <= TONE_MEAN_HIGH; mean += 5) {
      for (let stdev = TONE_STDEV_LOW; stdev <= 90; stdev += 5) {
        expect(toneAdjustment(stats(mean, stdev))).toBeNull();
      }
    }
  });

  it('lifts a dark face', () => {
    const tone = toneAdjustment(stats(60, 30))!;
    expect(tone.a).toBeGreaterThan(1);
    expect(tone.b).toBeGreaterThan(0);
  });

  it('compresses a blown-out face', () => {
    const tone = toneAdjustment(stats(210, 20))!;
    expect(tone.a).toBeLessThan(1);
    expect(tone.b).toBeLessThan(0);
  });

  it('lifts contrast on a flat but correctly-exposed face', () => {
    const tone = toneAdjustment(stats(128, 20))!;
    expect(tone.a).toBeGreaterThan(1);
  });

  // Without this cap a very flat dark frame would ask for an 11x gain, which is
  // sensor grain multiplied into blotches faster than median can remove it.
  it('caps the gain to avoid amplifying noise', () => {
    expect(toneAdjustment(stats(60, 5))!.a).toBe(GAIN_MAX);
  });

  it('clamps the offset', () => {
    expect(Math.abs(toneAdjustment(stats(5, 2))!.b)).toBeLessThanOrEqual(60);
  });

  it('never divides by a zero stdev', () => {
    const tone = toneAdjustment(stats(10, 0))!;
    expect(Number.isFinite(tone.a)).toBe(true);
    expect(Number.isFinite(tone.b)).toBe(true);
  });

  // Exposure is the half of the correction that must always succeed, because a
  // face landing short of the good band means a second pass over the same image
  // would want to correct it again — the signature of an over-processed picture.
  it('lands the mean inside the good band for any correctable exposure', () => {
    for (let mean = 45; mean <= 250; mean += 5) {
      for (const stdev of [3, 8, 20, 34, 45, 60, 90]) {
        const tone = toneAdjustment(stats(mean, stdev));
        if (tone === null) continue;
        const after = tone.a * mean + tone.b;
        expect(after).toBeGreaterThanOrEqual(TONE_MEAN_LOW);
        expect(after).toBeLessThanOrEqual(TONE_MEAN_HIGH);
      }
    }
  });

  // Beyond the correctable range the caps bind and the fix is partial by design —
  // rescuing a near-black frame would mean amplifying its noise tenfold. What is
  // never acceptable is overshooting past the target and inverting the problem.
  it('never overshoots, even on an image it cannot fully rescue', () => {
    for (const [mean, stdev] of [
      [5, 2],
      [10, 5],
      [25, 12],
      [30, 50],
    ]) {
      const tone = toneAdjustment(stats(mean, stdev))!;
      const after = tone.a * mean + tone.b;
      expect(after).toBeGreaterThan(mean);
      expect(after).toBeLessThanOrEqual(TONE_TARGET_MEAN);
    }
  });

  // Contrast, unlike exposure, is only granted what the offset budget allows —
  // so convergence is asserted exactly where the correction can reach the floor.
  it('converges in one pass whenever the corrected contrast reaches the floor', () => {
    for (let mean = 45; mean <= 250; mean += 5) {
      for (const stdev of [3, 8, 20, 34, 45, 60, 90]) {
        const tone = toneAdjustment(stats(mean, stdev));
        if (tone === null) continue;
        if (tone.a * stdev < TONE_STDEV_LOW) continue;
        const after = stats(tone.a * mean + tone.b, tone.a * stdev);
        expect(toneAdjustment(after)).toBeNull();
      }
    }
  });

  // The capped case cannot reach the contrast target in one pass — that is the
  // cap doing its job, not a bug. What it must still do is fix the exposure.
  it('fixes exposure in one pass even when the gain is capped', () => {
    const tone = toneAdjustment(stats(60, 5))!;
    const mean = tone.a * 60 + tone.b;
    expect(mean).toBeGreaterThanOrEqual(TONE_MEAN_LOW);
    expect(mean).toBeLessThanOrEqual(TONE_MEAN_HIGH);
  });

  // The bug this pins: choosing the gain from stdev alone makes a blown-out,
  // low-contrast face brighter still.
  it('does not brighten a face that is both blown out and flat', () => {
    const tone = toneAdjustment(stats(210, 12))!;
    expect(tone.a * 210 + tone.b).toBeLessThan(210);
  });

  it('lands a dark frame near the target mean', () => {
    const tone = toneAdjustment(stats(60, 34.4))!;
    expect(tone.a * 60 + tone.b).toBeCloseTo(TONE_TARGET_MEAN, 0);
  });

  it('drives measured stdev toward the target when uncapped', () => {
    const tone = toneAdjustment(stats(90, 40))!;
    expect(tone.a * 40).toBeCloseTo(TONE_TARGET_STDEV, 0);
  });
});

describe('needsDenoise', () => {
  it('denoises when we amplified the noise ourselves', () => {
    expect(needsDenoise(stats(100, 30), { a: 1.3, b: 10 })).toBe(true);
  });

  it('denoises a dark source regardless of the tone curve', () => {
    expect(needsDenoise(stats(60, 55), null)).toBe(true);
  });

  // Median filtering is not free, so it must not become a silent always-on cost
  // for the users whose camera is fine.
  it('leaves a well-exposed image alone', () => {
    expect(needsDenoise(stats(128, 55), null)).toBe(false);
  });

  it('does not denoise for a mild gain on a bright image', () => {
    expect(needsDenoise(stats(180, 30), { a: 1.1, b: -20 })).toBe(false);
  });
});

describe('sharpenParams', () => {
  // m1 = 0 means flat areas — skin, background — get no sharpening at all, so the
  // unsharp mask cannot amplify grain. Nothing else here is load-bearing.
  it('never sharpens flat areas', () => {
    expect(sharpenParams(true).m1).toBe(0);
    expect(sharpenParams(false).m1).toBe(0);
  });

  it('sharpens harder after an upscale than after a downscale', () => {
    expect(sharpenParams(true).sigma).toBeGreaterThan(
      sharpenParams(false).sigma,
    );
  });

  it('stays milder than sharp default of 3.0', () => {
    expect(sharpenParams(true).m2).toBeLessThan(3);
  });
});

describe('jpegQuality', () => {
  // Enrolment becomes the gallery every later login is measured against.
  it('spends more bytes on enrolment than on login', () => {
    expect(jpegQuality('enrol')).toBeGreaterThan(jpegQuality('login'));
  });
});
