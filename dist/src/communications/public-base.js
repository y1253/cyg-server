"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicBase = publicBase;
exports.signatureImageUrl = signatureImageUrl;
exports.requirePublicBase = requirePublicBase;
function publicBase(env) {
    const first = [env.PUBLIC_BASE_URL, env.CALLBACK_BASE_URL].find((value) => (value ?? '').trim() !== '');
    return (first ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
}
function signatureImageUrl(env, publicId) {
    return `${publicBase(env)}/api/signature-images/public/${encodeURIComponent(publicId)}`;
}
function requirePublicBase(env) {
    const first = [env.PUBLIC_BASE_URL, env.CALLBACK_BASE_URL].find((value) => (value ?? '').trim() !== '');
    if (!first) {
        throw new Error('PUBLIC_BASE_URL (or CALLBACK_BASE_URL) must be set to send picture or audio messages — ' +
            'the provider fetches the attachment from that address.');
    }
    return first.trim().replace(/\/+$/, '');
}
//# sourceMappingURL=public-base.js.map