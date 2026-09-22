"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHORT_SUMMARY_MAX_CHARS = void 0;
exports.clipToLine = clipToLine;
exports.parseSummaryReply = parseSummaryReply;
const SHORT_LABEL = /^[ \t]*\*{0,2}short\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/im;
const SUMMARY_LABEL = /^[ \t]*\*{0,2}summary\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/im;
exports.SHORT_SUMMARY_MAX_CHARS = 120;
function clipToLine(text, max = exports.SHORT_SUMMARY_MAX_CHARS) {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= max)
        return flat;
    const cut = flat.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    const body = space > max * 0.6 ? cut.slice(0, space) : cut;
    return body.replace(/[\s,;:.]+$/, '') + '…';
}
function firstSentence(text) {
    const flat = text.replace(/\s+/g, ' ').trim();
    const end = flat.search(/[.!?](\s|$)/);
    return end === -1 ? flat : flat.slice(0, end + 1);
}
function parseSummaryReply(raw) {
    const text = (raw ?? '').trim();
    if (!text)
        return { short: '', brief: '' };
    const shortAt = text.search(SHORT_LABEL);
    const summaryAt = text.search(SUMMARY_LABEL);
    const body = (at, label, otherAt, otherLabel) => {
        const m = label.exec(text.slice(at));
        const tail = m ? text.slice(at + m[0].length) : text.slice(at);
        if (otherAt > at) {
            const stop = tail.search(otherLabel);
            if (stop !== -1)
                return tail.slice(0, stop).trim();
        }
        return tail.trim();
    };
    let short = '';
    let brief = '';
    if (summaryAt !== -1) {
        brief = body(summaryAt, SUMMARY_LABEL, shortAt, SHORT_LABEL);
    }
    if (shortAt !== -1) {
        short = body(shortAt, SHORT_LABEL, summaryAt, SUMMARY_LABEL);
        if (summaryAt === -1) {
            brief = short;
            short = '';
        }
    }
    if (!brief)
        brief = text;
    if (!short)
        short = firstSentence(brief);
    return { short: clipToLine(short), brief };
}
//# sourceMappingURL=summary-reply.util.js.map