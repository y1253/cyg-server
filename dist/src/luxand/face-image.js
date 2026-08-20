"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOX_MAX_SIDE = exports.BOX_MIN_W = exports.BOX_EDGE_TOLERANCE = exports.JPEG_QUALITY_ENROL = exports.JPEG_QUALITY_LOGIN = exports.DENOISE_DARK_MEAN = exports.DENOISE_GAIN = exports.OFFSET_ABS_MAX = exports.GAIN_MAX = exports.GAIN_MIN = exports.TONE_STDEV_LOW = exports.TONE_MEAN_HIGH = exports.TONE_MEAN_LOW = exports.TONE_TARGET_STDEV = exports.TONE_TARGET_MEAN = exports.CROP_MAX_COVERAGE = exports.NO_BOX_MAX_EDGE = exports.MIN_SIDE = exports.MAX_UPSCALE = exports.TARGET_SIDE = exports.TARGET_FACE_PX = exports.CROP_Y_BIAS = exports.CROP_MARGIN = void 0;
exports.parseFaceBox = parseFaceBox;
exports.parseFaceBoxes = parseFaceBoxes;
exports.cropRect = cropRect;
exports.targetSide = targetSide;
exports.noBoxResize = noBoxResize;
exports.resizeKernel = resizeKernel;
exports.lumaStats = lumaStats;
exports.toneAdjustment = toneAdjustment;
exports.needsDenoise = needsDenoise;
exports.sharpenParams = sharpenParams;
exports.jpegQuality = jpegQuality;
exports.CROP_MARGIN = 1.8;
exports.CROP_Y_BIAS = 0.06;
exports.TARGET_FACE_PX = 320;
exports.TARGET_SIDE = 576;
exports.MAX_UPSCALE = 2.0;
exports.MIN_SIDE = 256;
exports.NO_BOX_MAX_EDGE = 1280;
exports.CROP_MAX_COVERAGE = 0.9;
exports.TONE_TARGET_MEAN = 128;
exports.TONE_TARGET_STDEV = 55;
exports.TONE_MEAN_LOW = 110;
exports.TONE_MEAN_HIGH = 175;
exports.TONE_STDEV_LOW = 45;
exports.GAIN_MIN = 0.8;
exports.GAIN_MAX = 1.6;
exports.OFFSET_ABS_MAX = 60;
exports.DENOISE_GAIN = 1.25;
exports.DENOISE_DARK_MEAN = 80;
exports.JPEG_QUALITY_LOGIN = 92;
exports.JPEG_QUALITY_ENROL = 95;
exports.BOX_EDGE_TOLERANCE = 0.01;
exports.BOX_MIN_W = 0.05;
exports.BOX_MAX_SIDE = 0.9;
function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
function toFinite(value) {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function parseFaceBox(field) {
    if (field === null || field === undefined || field === '')
        return null;
    let raw = field;
    if (typeof field === 'string') {
        try {
            raw = JSON.parse(field);
        }
        catch {
            return null;
        }
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return null;
    const src = raw;
    const x = toFinite(src.x);
    const y = toFinite(src.y);
    const w = toFinite(src.w);
    const h = toFinite(src.h);
    if (x === null || y === null || w === null || h === null)
        return null;
    if (w <= 0 || h <= 0)
        return null;
    if (w < exports.BOX_MIN_W)
        return null;
    if (w > exports.BOX_MAX_SIDE || h > exports.BOX_MAX_SIDE)
        return null;
    const t = exports.BOX_EDGE_TOLERANCE;
    if (x < -t || y < -t || x + w > 1 + t || y + h > 1 + t)
        return null;
    const cx = clamp(x, 0, 1);
    const cy = clamp(y, 0, 1);
    return {
        x: cx,
        y: cy,
        w: clamp(w, 0, 1 - cx),
        h: clamp(h, 0, 1 - cy),
    };
}
function parseFaceBoxes(field, count) {
    const empty = new Array(count).fill(null);
    if (field === null || field === undefined || field === '')
        return empty;
    let raw = field;
    if (typeof field === 'string') {
        try {
            raw = JSON.parse(field);
        }
        catch {
            return empty;
        }
    }
    if (!Array.isArray(raw))
        return empty;
    return empty.map((_, i) => parseFaceBox(raw[i]));
}
function cropRect(box, imgW, imgH) {
    if (!(imgW > 0) || !(imgH > 0))
        return null;
    const boxW = box.w * imgW;
    const boxH = box.h * imgH;
    let side = Math.round(exports.CROP_MARGIN * Math.max(boxW, boxH));
    side = Math.min(side, imgW, imgH);
    if (side < 1)
        return null;
    if ((side * side) / (imgW * imgH) > exports.CROP_MAX_COVERAGE)
        return null;
    const cx = (box.x + box.w / 2) * imgW;
    const cy = (box.y + box.h / 2) * imgH - exports.CROP_Y_BIAS * boxH;
    const left = clamp(Math.round(cx - side / 2), 0, imgW - side);
    const top = clamp(Math.round(cy - side / 2), 0, imgH - side);
    return { left, top, width: side, height: side };
}
function targetSide(cropSidePx) {
    const capped = Math.min(exports.TARGET_SIDE, Math.round(cropSidePx * exports.MAX_UPSCALE));
    const side = clamp(capped, exports.MIN_SIDE, exports.TARGET_SIDE);
    return { side, upscaled: side > cropSidePx };
}
function noBoxResize(imgW, imgH) {
    const longEdge = Math.max(imgW, imgH);
    if (longEdge <= exports.NO_BOX_MAX_EDGE)
        return null;
    const scale = exports.NO_BOX_MAX_EDGE / longEdge;
    return {
        width: Math.max(1, Math.round(imgW * scale)),
        height: Math.max(1, Math.round(imgH * scale)),
    };
}
function resizeKernel(upscaled) {
    return upscaled ? 'mitchell' : 'lanczos3';
}
function lumaStats(raw, width, height, channels, region = 'all') {
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
function laplacianVariance(luma, w, h) {
    if (w < 3 || h < 3)
        return 0;
    const lap = (c) => 4 * luma[c] - luma[c - 1] - luma[c + 1] - luma[c - w] - luma[c + w];
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
function toneAdjustment(stats) {
    const exposureOk = stats.mean >= exports.TONE_MEAN_LOW && stats.mean <= exports.TONE_MEAN_HIGH;
    const contrastOk = stats.stdev >= exports.TONE_STDEV_LOW;
    if (exposureOk && contrastOk)
        return null;
    const mean = Math.max(stats.mean, 1);
    const wanted = exports.TONE_TARGET_STDEV / Math.max(stats.stdev, 1);
    const lo = Math.max(exports.GAIN_MIN, (exports.TONE_TARGET_MEAN - exports.OFFSET_ABS_MAX) / mean);
    const hi = Math.min(exports.GAIN_MAX, (exports.TONE_TARGET_MEAN + exports.OFFSET_ABS_MAX) / mean);
    const a = lo <= hi ? clamp(wanted, lo, hi) : clamp((lo + hi) / 2, exports.GAIN_MIN, exports.GAIN_MAX);
    const b = clamp(exports.TONE_TARGET_MEAN - a * stats.mean, -exports.OFFSET_ABS_MAX, exports.OFFSET_ABS_MAX);
    return { a, b };
}
function needsDenoise(stats, tone) {
    if (tone !== null && tone.a >= exports.DENOISE_GAIN)
        return true;
    return stats.mean < exports.DENOISE_DARK_MEAN;
}
function sharpenParams(upscaled) {
    return { sigma: upscaled ? 1.0 : 0.6, m1: 0, m2: 2.0 };
}
function jpegQuality(mode) {
    return mode === 'enrol' ? exports.JPEG_QUALITY_ENROL : exports.JPEG_QUALITY_LOGIN;
}
//# sourceMappingURL=face-image.js.map