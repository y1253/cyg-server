"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLACEHOLDERS = void 0;
exports.escapeHtml = escapeHtml;
exports.renderSignature = renderSignature;
exports.sanitizeSignatureHtml = sanitizeSignatureHtml;
exports.PLACEHOLDERS = [
    {
        token: '{company name}',
        label: 'Company name',
        key: 'company',
        example: 'Acme Bookkeeping',
    },
    {
        token: '{support number}',
        label: 'Support number',
        key: 'phone',
        example: '+1 438 256 1210',
    },
    {
        token: '{billing email}',
        label: 'Billing email',
        key: 'email',
        example: 'billing@acme.com',
    },
    {
        token: '{accountant}',
        label: 'Accountant',
        key: 'accountant',
        example: 'Dana Levy',
    },
    {
        token: '{accountant email}',
        label: 'Accountant email',
        key: 'accountantemail',
        example: 'dana@cygfinance.com',
    },
    {
        token: '{accountant phone}',
        label: 'Accountant phone',
        key: 'accountantphone',
        example: '+1 514 555 0100',
    },
    {
        token: '{logo}',
        label: 'Logo',
        key: 'logo',
        example: '[logo]',
    },
];
const TOKEN_RE = /\{\s*([a-z][a-z ]*?)\s*\}/gi;
function normalizeKey(raw) {
    return raw.toLowerCase().replace(/\s+/g, '');
}
const KEY_ALIASES = {
    company: 'company',
    companyname: 'company',
    business: 'company',
    businessname: 'company',
    phone: 'phone',
    number: 'phone',
    supportnumber: 'phone',
    email: 'email',
    billingemail: 'email',
    accountant: 'accountant',
    accountantname: 'accountant',
    accountantemail: 'accountantemail',
    accountantphone: 'accountantphone',
    logo: 'logo',
    image: 'logo',
};
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const LOGO_MAX_WIDTH_PX = 180;
function logoTag(url) {
    return (`<img src="${escapeHtml(url)}" alt="" ` +
        `style="max-width:${LOGO_MAX_WIDTH_PX}px;height:auto;border:0" />`);
}
function renderSignature(template, vars) {
    if (typeof template !== 'string')
        return '';
    return template.replace(TOKEN_RE, (match, rawKey) => {
        const key = KEY_ALIASES[normalizeKey(rawKey)];
        if (!key)
            return match;
        if (key === 'logo')
            return vars.logoUrl ? logoTag(vars.logoUrl) : '';
        return escapeHtml(vars[key] ?? '');
    });
}
const FORBIDDEN_ELEMENTS = /<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const FORBIDDEN_TAGS = /<\s*\/?\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi;
const EVENT_ATTRS = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URLS = /\s(?:href|src|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi;
function sanitizeSignatureHtml(html) {
    if (typeof html !== 'string')
        return '';
    return html
        .replace(FORBIDDEN_ELEMENTS, '')
        .replace(FORBIDDEN_TAGS, '')
        .replace(EVENT_ATTRS, '')
        .replace(JS_URLS, '');
}
//# sourceMappingURL=signature-template.util.js.map