"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LOGO_EDGE_PX = void 0;
exports.boundedSize = boundedSize;
exports.defaultImageName = defaultImageName;
exports.MAX_LOGO_EDGE_PX = 600;
function boundedSize(source) {
    const longest = Math.max(source.width, source.height);
    if (longest <= exports.MAX_LOGO_EDGE_PX)
        return { ...source };
    const scale = exports.MAX_LOGO_EDGE_PX / longest;
    return {
        width: Math.max(1, Math.round(source.width * scale)),
        height: Math.max(1, Math.round(source.height * scale)),
    };
}
function defaultImageName(originalName) {
    const base = (originalName ?? '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.[^.]+$/, '')
        .trim();
    return base.slice(0, 80) || 'Untitled';
}
//# sourceMappingURL=signature-image.util.js.map