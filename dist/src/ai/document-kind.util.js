"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentKind = documentKind;
exports.mimeForFilename = mimeForFilename;
const TEXT_MIMES = new Set([
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/html',
    'application/json',
]);
const TEXT_EXTS = new Set(['.txt', '.csv', '.md', '.html', '.htm', '.json']);
const IMAGE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const LEGACY_DOC_EXTS = new Set(['.doc', '.xls', '.ppt']);
function extensionOf(filename) {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(dot).toLowerCase() : '';
}
function baseMime(mimetype) {
    return (mimetype || '').split(';')[0]?.trim().toLowerCase() ?? '';
}
function documentKind(mimetype, filename) {
    const mime = baseMime(mimetype);
    const ext = extensionOf(filename);
    if (LEGACY_DOC_EXTS.has(ext)) {
        return {
            refuse: 'That is an older Office format, which cannot be read here. Save it as a PDF and try again.',
        };
    }
    const claims = [
        ['text', TEXT_MIMES, TEXT_EXTS],
        ['image', IMAGE_MIMES, IMAGE_EXTS],
    ];
    for (const [kind, mimes, exts] of claims) {
        if (!mimes.has(mime))
            continue;
        if (ext && !exts.has(ext))
            break;
        return { kind };
    }
    if (mime === 'application/pdf' && (!ext || ext === '.pdf')) {
        return { kind: 'pdf' };
    }
    if (ext === '.pdf')
        return { kind: 'pdf' };
    return {
        refuse: 'That kind of file cannot be summarised. PDFs, pictures and plain text files can be.',
    };
}
function mimeForFilename(filename) {
    const ext = extensionOf(filename);
    const byExt = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.md': 'text/markdown',
        '.html': 'text/html',
        '.htm': 'text/html',
        '.json': 'application/json',
    };
    return byExt[ext] ?? '';
}
//# sourceMappingURL=document-kind.util.js.map