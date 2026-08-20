/**
 * Pure image-geometry and tone maths for the pre-Luxand enhancement pass.
 *
 * Nothing here imports sharp, Nest or fs — the sharp calls live in
 * `face-enhancer.service.ts`. The split mirrors `luxand-parse.ts`: the decisions
 * that are easy to get subtly wrong (a crop rect one pixel outside the image, a
 * tone curve that fights its own output) are the ones worth unit-testing, and
 * they are exactly the ones that do not need an image decoder to test.
 */

// ── Constants ────────────────────────────────────────────────────────────────
// Exported so the probe script can sweep them. They are deliberately NOT env
// vars: a knob nobody has measurements for is a liability.

/**
 * The crop is the face box scaled by this, NOT the box itself.
 *
 * A tight crop is the intuitive reading of "crop around the face" and it is the
 * wrong thing to send Luxand. Luxand runs its own detector and its own alignment
 * on whatever arrives; a face flush against the frame edge, stripped of hair,
 * chin and head outline, is harder for a detector to find than the original
 * frame was. That turns a merely degraded login into a failed one.
 */
export const CROP_MARGIN = 1.8;

/**
 * Shift the crop centre up by this fraction of the box height: BlazeFace boxes
 * cut the forehead, and the hairline carries identity signal.
 */
export const CROP_Y_BIAS = 0.06;

/** Face width, in pixels, that the output aims for. */
export const TARGET_FACE_PX = 320;

/** Output side = TARGET_FACE_PX * CROP_MARGIN, rounded to a JPEG MCU multiple. */
export const TARGET_SIDE = 576;

/**
 * Interpolation cannot create identity information. Past ~2x on a soft webcam
 * frame you amplify sensor grain and invent edge detail, which moves the
 * embedding away from the gallery rather than toward it.
 */
export const MAX_UPSCALE = 2.0;

/** Floor, so a pathologically small crop still gets a usable face to Luxand. */
export const MIN_SIDE = 256;

/** No-box path: downscale only, never up — we do not know where the face is. */
export const NO_BOX_MAX_EDGE = 1280;

/** A crop covering more of the frame than this buys nothing over the original. */
export const CROP_MAX_COVERAGE = 0.9;

export const TONE_TARGET_MEAN = 128;
export const TONE_TARGET_STDEV = 55;
/** Mean luma inside this band counts as correctly exposed. */
export const TONE_MEAN_LOW = 110;
export const TONE_MEAN_HIGH = 175;
/** Stdev at or above this counts as adequate contrast. */
export const TONE_STDEV_LOW = 45;
/** The gain ceiling is the anti-noise cap: past ~1.6x grain outruns denoising. */
export const GAIN_MIN = 0.8;
export const GAIN_MAX = 1.6;
export const OFFSET_ABS_MAX = 60;

/** Denoise once we have amplified this much — that noise is ours, not the sensor's. */
export const DENOISE_GAIN = 1.25;
/** A face crop this dark came off a sensor at high gain, whatever we then do to it. */
export const DENOISE_DARK_MEAN = 80;

export const JPEG_QUALITY_LOGIN = 92;
/** Enrolment is one-time and becomes the gallery, so it can afford the bytes. */
export const JPEG_QUALITY_ENROL = 95;

/** MediaPipe boxes routinely poke a pixel or two past the frame edge. */
export const BOX_EDGE_TOLERANCE = 0.01;
/** Below this the "face" is a spurious detection, or too small to crop usefully. */
export const BOX_MIN_W = 0.05;
/** Above this there is no background left to remove. */
export const BOX_MAX_SIDE = 0.9;

// ── Types ────────────────────────────────────────────────────────────────────

/** Face box as fractions of frame width/height, origin top-left. */
export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Integer pixel rect, in the space sharp's `.extract()` expects. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LumaStats {
  mean: number;
  stdev: number;
  /** Variance of the Laplacian — the same detail measure the client gates on. */
  laplacianVar: number;
}

/** `out = a * in + b`, i.e. sharp's `.linear()`. */
export interface ToneAdjustment {
  a: number;
  b: number;
}

export interface RawPhoto {
  buffer: Buffer;
  mimeType?: string;
}

/**
 * A photo that has been through the enhancement pass.
 *
 * The brand is not decoration. Liveness must never see enhanced pixels (see
 * `LuxandService.liveness`), and the only thing between "must not" and "did" used
 * to be one boolean argument at one call site. `liveness` accepts
 * `RawPhoto & { __enhanced?: never }`, so handing it an EnhancedPhoto is a
 * compile error, while a bare multer buffer still satisfies RawPhoto
 * structurally and nothing is inconvenienced.
 */
export type EnhancedPhoto = RawPhoto & { readonly __enhanced: true };

export type PhotoMode = 'login' | 'enrol';

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Accepts numbers and numeric strings; rejects NaN, Infinity and everything else. */
function toFinite(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ── Box parsing ──────────────────────────────────────────────────────────────

/**
 * Parse the `faceBox` multipart field.
 *
 * Never throws and never rejects the request. A stale client build sending a
 * malformed box must fall back to the no-box path — which still resizes, tones,
 * denoises and sharpens — rather than lock somebody out of the application. The
 * crop is an enhancement to the enhancement, never a precondition.
 */
export function parseFaceBox(field: unknown): NormalizedBox | null {
  if (field === null || field === undefined || field === '') return null;

  let raw: unknown = field;
  if (typeof field === 'string') {
    try {
      raw = JSON.parse(field);
    } catch {
      return null;
    }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;

  const src = raw as Record<string, unknown>;
  const x = toFinite(src.x);
  const y = toFinite(src.y);
  const w = toFinite(src.w);
  const h = toFinite(src.h);
  if (x === null || y === null || w === null || h === null) return null;

  if (w <= 0 || h <= 0) return null;
  if (w < BOX_MIN_W) return null;
  // Not an error, just nothing to gain — falls through to the no-box path.
  if (w > BOX_MAX_SIDE || h > BOX_MAX_SIDE) return null;

  const t = BOX_EDGE_TOLERANCE;
  if (x < -t || y < -t || x + w > 1 + t || y + h > 1 + t) return null;

  // Inside the tolerance, so clamp rather than reject.
  const cx = clamp(x, 0, 1);
  const cy = clamp(y, 0, 1);
  return {
    x: cx,
    y: cy,
    w: clamp(w, 0, 1 - cx),
    h: clamp(h, 0, 1 - cy),
  };
}

/**
 * Parse the enrolment `boxes` field: a JSON array, index-aligned with the photos.
 *
 * Always returns exactly `count` entries, so the caller can zip it against the
 * files without a length check. A missing or unparseable entry becomes null and
 * that one photo takes the no-box path on its own.
 */
export function parseFaceBoxes(
  field: unknown,
  count: number,
): (NormalizedBox | null)[] {
  const empty = new Array<NormalizedBox | null>(count).fill(null);
  if (field === null || field === undefined || field === '') return empty;

  let raw: unknown = field;
  if (typeof field === 'string') {
    try {
      raw = JSON.parse(field);
    } catch {
      return empty;
    }
  }
  if (!Array.isArray(raw)) return empty;

  return empty.map((_, i) => parseFaceBox(raw[i]));
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * The square crop around a face box, in pixels, guaranteed inside the image.
 *
 * Square because `fit: 'fill'` onto a square output then never distorts.
 *
 * The clamping order is where `extract_area: bad extract area` comes from in
 * production. A face near an edge SHIFTS the square back inside rather than
 * shrinking it, so it keeps full context on the side where context exists, and
 * every value is re-clamped after rounding.
 */
export function cropRect(
  box: NormalizedBox,
  imgW: number,
  imgH: number,
): CropRect | null {
  if (!(imgW > 0) || !(imgH > 0)) return null;

  const boxW = box.w * imgW;
  const boxH = box.h * imgH;

  let side = Math.round(CROP_MARGIN * Math.max(boxW, boxH));
  side = Math.min(side, imgW, imgH);
  if (side < 1) return null;

  // Nothing left to remove — the caller falls back to the no-box path.
  if ((side * side) / (imgW * imgH) > CROP_MAX_COVERAGE) return null;

  const cx = (box.x + box.w / 2) * imgW;
  const cy = (box.y + box.h / 2) * imgH - CROP_Y_BIAS * boxH;

  const left = clamp(Math.round(cx - side / 2), 0, imgW - side);
  const top = clamp(Math.round(cy - side / 2), 0, imgH - side);

  return { left, top, width: side, height: side };
}

/**
 * Output side length for a crop of `cropSidePx`, and whether that is an upscale.
 *
 * TARGET_SIDE is chosen so as not to regress the population that already works: a
 * good camera at 1280x720 passing the client gate's `minSizeRatio: 0.28` already
 * delivers a ~358px face. Aiming lower would downscale the users who have no
 * problem in order to help the ones who do.
 */
export function targetSide(cropSidePx: number): {
  side: number;
  upscaled: boolean;
} {
  const capped = Math.min(TARGET_SIDE, Math.round(cropSidePx * MAX_UPSCALE));
  const side = clamp(capped, MIN_SIDE, TARGET_SIDE);
  return { side, upscaled: side > cropSidePx };
}

/**
 * Long-edge downscale for the no-box path. Returns null when the image is already
 * small enough — we never upscale here, because without a box an upscale is a
 * coin flip on where the face even is.
 */
export function noBoxResize(
  imgW: number,
  imgH: number,
): { width: number; height: number } | null {
  const longEdge = Math.max(imgW, imgH);
  if (longEdge <= NO_BOX_MAX_EDGE) return null;
  const scale = NO_BOX_MAX_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(imgW * scale)),
    height: Math.max(1, Math.round(imgH * scale)),
  };
}

/**
 * Lanczos ringing is acutance when shrinking and halos when enlarging. On an
 * already-soft webcam frame those halos are fabricated high-frequency detail
 * around eyes and nostrils, fed straight to an embedder.
 */
export function resizeKernel(upscaled: boolean): 'lanczos3' | 'mitchell' {
  return upscaled ? 'mitchell' : 'lanczos3';
}

// ── Measurement ──────────────────────────────────────────────────────────────

/**
 * Rec.601 luma statistics over a raw RGB(A) buffer.
 *
 * Rec.601 specifically, matching `client/src/lib/faceQuality.ts` — the client's
 * brightness gate and this measurement then denote the same quantity, so their
 * thresholds can be reasoned about together.
 *
 * `region: 'center'` measures the central 50% rectangle. That is the no-box proxy
 * for "where the face probably is", and it exists because whole-frame statistics
 * get the backlit case exactly backwards: a bright window behind a dark face
 * raises the mean, the image reads as "not dark", and the face stays a silhouette.
 */
export function lumaStats(
  raw: Buffer | Uint8Array,
  width: number,
  height: number,
  channels: number,
  region: 'all' | 'center' = 'all',
): LumaStats {
  const x0 = region === 'center' ? Math.floor(width * 0.25) : 0;
  const y0 = region === 'center' ? Math.floor(height * 0.25) : 0;
  const x1 = region === 'center' ? Math.ceil(width * 0.75) : width;
  const y1 = region === 'center' ? Math.ceil(height * 0.75) : height;

  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const luma = new Float64Array(w * h);

  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * channels;
      const v = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
      luma[y * w + x] = v;
      sum += v;
    }
  }

  const n = w * h;
  const mean = sum / n;

  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = luma[i] - mean;
    varSum += d * d;
  }
  const stdev = Math.sqrt(varSum / n);

  return { mean, stdev, laplacianVar: laplacianVariance(luma, w, h) };
}

/** 4-neighbour Laplacian variance over the interior. Zero for anything under 3px. */
function laplacianVariance(luma: Float64Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;

  const lap = (c: number) =>
    4 * luma[c] - luma[c - 1] - luma[c + 1] - luma[c - w] - luma[c + w];

  let sum = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      sum += lap(y * w + x);
      count++;
    }
  }
  const mean = sum / count;

  let acc = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = lap(y * w + x) - mean;
      acc += d * d;
    }
  }
  return acc / count;
}

// ── Tone ─────────────────────────────────────────────────────────────────────

/**
 * The `.linear(a, b)` correction for a measured face crop, or null to leave the
 * image alone.
 *
 * Returning null for a well-exposed face is the most important behaviour in this
 * module. It is what makes a good camera's photo come out characteristically
 * identical to today's, which is in turn what makes "already-enrolled staff do not
 * need to re-enrol" true rather than hopeful.
 *
 * One formula covers dark and blown: a > 1 stretches a flat dark face, a < 1
 * compresses a washed-out backlit one. `.normalize()` was removed in favour of
 * this because it is per-channel (so it shifts skin tone), is defeated by a single
 * specular highlight, and applies unconditionally.
 *
 * **Exposure outranks contrast.** The gain wanted for contrast is only granted
 * within the window that still lets the offset reach TONE_TARGET_MEAN without
 * hitting its own clamp. Choosing the gain from stdev alone and clamping the
 * offset afterwards produces two failures that are easy to ship and hard to spot:
 * a face that is blown out *and* flat asks for a large gain and gets *brighter*,
 * and a dark face whose offset is truncated lands short of the good band — so a
 * second pass over the same image would want to correct it again, which is the
 * signature of an over-processed picture.
 */
export function toneAdjustment(stats: LumaStats): ToneAdjustment | null {
  const exposureOk =
    stats.mean >= TONE_MEAN_LOW && stats.mean <= TONE_MEAN_HIGH;
  const contrastOk = stats.stdev >= TONE_STDEV_LOW;
  if (exposureOk && contrastOk) return null;

  const mean = Math.max(stats.mean, 1);
  const wanted = TONE_TARGET_STDEV / Math.max(stats.stdev, 1);

  // Gains for which `TONE_TARGET_MEAN - a * mean` still fits the offset clamp.
  const lo = Math.max(GAIN_MIN, (TONE_TARGET_MEAN - OFFSET_ABS_MAX) / mean);
  const hi = Math.min(GAIN_MAX, (TONE_TARGET_MEAN + OFFSET_ABS_MAX) / mean);

  // An empty window means the image is beyond what a 1.6x gain and a 60-step
  // offset can fully correct — a near-black or blinding frame. Take the closest
  // permitted gain and accept a partial fix; the alternative is amplifying noise
  // by 10x to rescue an image the client's brightness gate should have refused.
  const a =
    lo <= hi ? clamp(wanted, lo, hi) : clamp((lo + hi) / 2, GAIN_MIN, GAIN_MAX);

  const b = clamp(
    TONE_TARGET_MEAN - a * stats.mean,
    -OFFSET_ABS_MAX,
    OFFSET_ABS_MAX,
  );
  return { a, b };
}

/**
 * Median filtering costs a little real detail, so it is gated on the two cases
 * where noise is near-certain: we amplified it ourselves, or the source was dark
 * enough that the sensor was at high gain regardless.
 */
export function needsDenoise(
  stats: LumaStats,
  tone: ToneAdjustment | null,
): boolean {
  if (tone !== null && tone.a >= DENOISE_GAIN) return true;
  return stats.mean < DENOISE_DARK_MEAN;
}

/**
 * Mild unsharp mask.
 *
 * `m1: 0` is the parameter that matters and the one that must never be
 * "simplified" away: m1 is the gain applied to flat areas, so zero means skin and
 * background grain get no boost at all while edges still get m2. `m2: 2.0` rather
 * than sharp's default 3.0 is what makes this mild instead of crunchy.
 */
export function sharpenParams(upscaled: boolean): {
  sigma: number;
  m1: number;
  m2: number;
} {
  return { sigma: upscaled ? 1.0 : 0.6, m1: 0, m2: 2.0 };
}

export function jpegQuality(mode: PhotoMode): number {
  return mode === 'enrol' ? JPEG_QUALITY_ENROL : JPEG_QUALITY_LOGIN;
}
