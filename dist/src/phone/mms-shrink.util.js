"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MMS_IMAGE_LADDER = void 0;
exports.perFileBudget = perFileBudget;
exports.isMmsImage = isMmsImage;
exports.MMS_IMAGE_LADDER = [
    { edge: 1600, quality: 80 },
    { edge: 1024, quality: 65 },
    { edge: 640, quality: 45 },
];
function perFileBudget(total, fileCount) {
    return Math.max(1, Math.floor(total / Math.max(1, fileCount)));
}
const MMS_IMAGE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
]);
const MMS_MIME_BY_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};
function isMmsImage(mimetype, filename) {
    const base = (mimetype ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!MMS_IMAGE_MIMES.has(base))
        return false;
    const name = filename ?? '';
    const dot = name.lastIndexOf('.');
    const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
    if (!ext)
        return true;
    return MMS_MIME_BY_EXTENSION[ext] === base;
}
//# sourceMappingURL=mms-shrink.util.js.map