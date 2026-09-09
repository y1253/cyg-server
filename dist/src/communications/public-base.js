"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicBase = publicBase;
exports.signatureImageUrl = signatureImageUrl;
function publicBase(env) {
    const first = [env.PUBLIC_BASE_URL, env.CALLBACK_BASE_URL].find((value) => (value ?? '').trim() !== '');
    return (first ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
}
function signatureImageUrl(env, publicId) {
    return `${publicBase(env)}/api/signature-images/public/${encodeURIComponent(publicId)}`;
}
//# sourceMappingURL=public-base.js.map