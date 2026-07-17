"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeHeaderWord = encodeHeaderWord;
exports.attachmentNameParams = attachmentNameParams;
const isAscii = (s) => {
    return /^[\x00-\x7F]*$/.test(s);
};
const MAX_WORD_BYTES = 42;
function encodeHeaderWord(value) {
    const clean = (value ?? '').replace(/[\r\n]+/g, ' ');
    if (clean === '')
        return '';
    if (isAscii(clean))
        return clean;
    const words = [];
    let chunk = '';
    const push = () => {
        if (chunk !== '') {
            words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
        }
    };
    for (const ch of clean) {
        const next = chunk + ch;
        if (Buffer.byteLength(next, 'utf8') > MAX_WORD_BYTES) {
            push();
            chunk = ch;
        }
        else {
            chunk = next;
        }
    }
    push();
    return words.join('\r\n ');
}
function attachmentNameParams(filename) {
    const clean = (filename || 'attachment').replace(/["\r\n\\]/g, '_');
    if (isAscii(clean)) {
        return { asciiName: clean, filenameParam: '' };
    }
    const ext = /(\.[A-Za-z0-9]{1,8})$/.exec(clean)?.[1] ?? '';
    return {
        asciiName: `attachment${ext}`,
        filenameParam: `; filename*=UTF-8''${encodeURIComponent(clean)}`,
    };
}
//# sourceMappingURL=encode-header.js.map