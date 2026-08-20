"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referencedCidsFromHtml = referencedCidsFromHtml;
exports.normalizeContentId = normalizeContentId;
exports.isBodyEmbedded = isBodyEmbedded;
function referencedCidsFromHtml(bodyHtml) {
    const referencedCids = new Set();
    for (const m of (bodyHtml ?? '').matchAll(/cid:([^"'>\s)]+)/gi)) {
        referencedCids.add(m[1]);
        try {
            referencedCids.add(decodeURIComponent(m[1]));
        }
        catch {
        }
    }
    return referencedCids;
}
function normalizeContentId(rawContentId) {
    if (!rawContentId)
        return null;
    const trimmed = rawContentId.trim().replace(/^<|>$/g, '');
    return trimmed.length > 0 ? trimmed : null;
}
function isBodyEmbedded(contentId, referencedCids) {
    const id = normalizeContentId(contentId);
    return id !== null && referencedCids.has(id);
}
//# sourceMappingURL=inline-attachments.util.js.map