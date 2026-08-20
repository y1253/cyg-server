"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractScore = extractScore;
exports.normalizeScore = normalizeScore;
exports.extractId = extractId;
exports.isFailureEnvelope = isFailureEnvelope;
exports.failureMessage = failureMessage;
exports.describeLuxandError = describeLuxandError;
exports.isImageRejection = isImageRejection;
const SCORE_KEYS = [
    'probability',
    'confidence',
    'similarity',
    'score',
];
const ID_KEYS = ['uuid', 'id', 'person_uuid', 'personUuid'];
const SAFE_TO_SURFACE = [
    'no face detected',
    'find faces',
    'issues with the image',
];
function scanForScore(obj) {
    if (!obj || typeof obj !== 'object')
        return null;
    const rec = obj;
    for (const key of SCORE_KEYS) {
        const value = rec[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' &&
            value.trim() &&
            !Number.isNaN(Number(value))) {
            return Number(value);
        }
    }
    return null;
}
function scanForId(obj, keys) {
    if (!obj || typeof obj !== 'object')
        return null;
    const rec = obj;
    for (const key of keys) {
        const value = rec[key];
        if (typeof value === 'string' && value)
            return value;
        if (typeof value === 'number')
            return String(value);
    }
    return null;
}
function extractScore(data) {
    if (Array.isArray(data))
        return data.length ? scanForScore(data[0]) : null;
    const direct = scanForScore(data);
    if (direct !== null)
        return direct;
    const rec = data ?? {};
    return scanForScore(rec.result) ?? scanForScore(rec.data);
}
function normalizeScore(score) {
    return score > 1 ? score / 100 : score;
}
function extractId(data) {
    const root = Array.isArray(data) ? (data[0] ?? null) : data;
    const direct = scanForId(root, ID_KEYS);
    if (direct)
        return direct;
    const rec = (root ?? {});
    return (scanForId(rec.person, ['uuid', 'id']) ??
        scanForId(rec.result, ['uuid', 'id']) ??
        scanForId(rec.data, ['uuid', 'id']));
}
function isFailureEnvelope(data) {
    return data !== null && !Array.isArray(data) && data.status === 'failure';
}
function failureMessage(data, raw) {
    if (data && !Array.isArray(data)) {
        const message = data.message;
        if (typeof message === 'string' && message)
            return message;
    }
    return raw;
}
function describeLuxandError(message) {
    return isImageRejection(message) ? message.trim() : 'Face service error';
}
function isImageRejection(message) {
    const lower = message.toLowerCase();
    return SAFE_TO_SURFACE.some((s) => lower.includes(s));
}
//# sourceMappingURL=luxand-parse.js.map