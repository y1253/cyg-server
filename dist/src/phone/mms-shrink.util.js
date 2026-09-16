"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MMS_AUDIO_ARGS = exports.MMS_IMAGE_LADDER = void 0;
exports.perFileBudget = perFileBudget;
exports.mmsMediaClass = mmsMediaClass;
exports.MMS_IMAGE_LADDER = [
    { edge: 1600, quality: 80 },
    { edge: 1024, quality: 65 },
    { edge: 640, quality: 45 },
];
exports.MMS_AUDIO_ARGS = [
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '32k',
    '-f',
    'mp3',
];
function perFileBudget(total, fileCount) {
    return Math.max(1, Math.floor(total / Math.max(1, fileCount)));
}
function mmsMediaClass(contentType) {
    const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (base.startsWith('image/'))
        return 'image';
    if (base.startsWith('audio/'))
        return 'audio';
    return 'other';
}
//# sourceMappingURL=mms-shrink.util.js.map