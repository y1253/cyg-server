"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_SIGNATURE_HEADER = exports.SIGNATURE_HEADER = void 0;
exports.signatureBase = signatureBase;
exports.computeSignature = computeSignature;
exports.verifySignature = verifySignature;
const node_crypto_1 = require("node:crypto");
exports.SIGNATURE_HEADER = 'x-signalwire-signature';
exports.LEGACY_SIGNATURE_HEADER = 'x-twilio-signature';
function signatureBase(url, params) {
    return Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + String(params[key] ?? ''), url);
}
function computeSignature(url, params, signingKey) {
    return (0, node_crypto_1.createHmac)('sha1', signingKey)
        .update(Buffer.from(signatureBase(url, params), 'utf-8'))
        .digest('base64');
}
function safeEqual(a, b) {
    const left = Buffer.from(a, 'utf-8');
    const right = Buffer.from(b, 'utf-8');
    if (left.length !== right.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(left, right);
}
function verifySignature(signature, url, params, signingKey) {
    if (!signature || !signingKey)
        return false;
    try {
        return safeEqual(signature, computeSignature(url, params, signingKey));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=signature.util.js.map