"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeHtmlEntities = decodeHtmlEntities;
exports.fromDisplayName = fromDisplayName;
function decodeHtmlEntities(text) {
    return (text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&#x0*27;/gi, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&amp;/g, '&'));
}
function fromDisplayName(header) {
    const raw = header.trim();
    if (!raw)
        return '';
    const angle = raw.lastIndexOf('<');
    const name = angle === -1 ? '' : raw.slice(0, angle).trim();
    if (name) {
        const unquoted = /^"(.*)"$/s.exec(name);
        return (unquoted ? unquoted[1].replace(/\\(.)/g, '$1') : name).trim();
    }
    if (angle !== -1) {
        const close = raw.indexOf('>', angle);
        const addr = raw.slice(angle + 1, close === -1 ? undefined : close).trim();
        if (addr)
            return addr;
    }
    return raw;
}
//# sourceMappingURL=preview.util.js.map