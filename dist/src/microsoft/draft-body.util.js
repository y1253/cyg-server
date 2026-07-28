"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertAboveQuote = insertAboveQuote;
exports.textToHtml = textToHtml;
function insertAboveQuote(userHtml, draftHtml) {
    if (!draftHtml)
        return userHtml;
    if (!userHtml)
        return draftHtml;
    const openBody = /<body\b[^>]*>/i.exec(draftHtml);
    if (!openBody)
        return `${userHtml}<br>${draftHtml}`;
    const at = openBody.index + openBody[0].length;
    return draftHtml.slice(0, at) + userHtml + draftHtml.slice(at);
}
function textToHtml(text) {
    const escaped = (text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<div>${escaped.replace(/\r?\n/g, '<br>')}</div>`;
}
//# sourceMappingURL=draft-body.util.js.map