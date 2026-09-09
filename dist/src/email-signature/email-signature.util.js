"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HARDCODED_FALLBACK = exports.SEED_DEFAULTS = exports.SIGNATURE_FIELDS = exports.SETTINGS_SINGLETON = void 0;
exports.resolveSignature = resolveSignature;
exports.imageIdOrNone = imageIdOrNone;
exports.SETTINGS_SINGLETON = 'GLOBAL';
exports.SIGNATURE_FIELDS = [
    'signatureHtml',
    'signatureImageId',
];
exports.SEED_DEFAULTS = {
    signatureHtml: [
        '<div>{company name}</div>',
        '<div>Accounting Department</div>',
        '<div>{support number}</div>',
        '<div>{billing email}</div>',
        '<div><br></div>',
        '<div style="font-size:0.85em">accounting managed by ' +
            '<a href="https://cygfinance.com">CYG FINANCE</a></div>',
    ].join(''),
    signatureImageId: 0,
};
exports.HARDCODED_FALLBACK = exports.SEED_DEFAULTS;
function resolveSignature(global, company) {
    const base = global
        ? { ...global }
        : { ...exports.HARDCODED_FALLBACK };
    const effective = {};
    const source = {};
    for (const key of exports.SIGNATURE_FIELDS) {
        const override = company?.[key] ?? null;
        effective[key] = override ?? base[key];
        source[key] = override === null ? 'default' : 'company';
    }
    return { effective, source };
}
function imageIdOrNone(value) {
    return typeof value === 'number' && value > 0 ? value : null;
}
//# sourceMappingURL=email-signature.util.js.map