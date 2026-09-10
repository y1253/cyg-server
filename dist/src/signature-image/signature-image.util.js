"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_COMPANY_LOGOS = exports.MAX_LOGO_EDGE_PX = void 0;
exports.boundedSize = boundedSize;
exports.defaultImageName = defaultImageName;
exports.isImageVisibleTo = isImageVisibleTo;
exports.isImageInLibrary = isImageInLibrary;
exports.imageScopeWhere = imageScopeWhere;
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
function isImageVisibleTo(image, scope) {
    return image === null || image === scope;
}
function isImageInLibrary(image, scope) {
    return image === scope;
}
function imageScopeWhere(scope) {
    return scope === null
        ? { companyId: null }
        : { OR: [{ companyId: null }, { companyId: scope }] };
}
exports.MAX_COMPANY_LOGOS = 10;
//# sourceMappingURL=signature-image.util.js.map