"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLACEHOLDERS = void 0;
exports.renderMessage = renderMessage;
exports.PLACEHOLDERS = [
    {
        token: '{company name}',
        label: 'Company name',
        key: 'company',
        example: 'Acme Bookkeeping',
    },
    {
        token: '{phone}',
        label: 'Support number',
        key: 'phone',
        example: '+1 438 256 1210',
    },
    {
        token: '{hours}',
        label: "Today's hours",
        key: 'hours',
        example: '9 AM to 5 PM',
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
    hours: 'hours',
    todayshours: 'hours',
};
function renderMessage(template, vars) {
    if (typeof template !== 'string')
        return '';
    return template.replace(TOKEN_RE, (match, rawKey) => {
        const key = KEY_ALIASES[normalizeKey(rawKey)];
        if (!key)
            return match;
        return vars[key] ?? '';
    });
}
//# sourceMappingURL=phone-message.util.js.map