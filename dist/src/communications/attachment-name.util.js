"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachmentNameParams = attachmentNameParams;
const isAscii = (s) => {
    return /^[\x00-\x7F]*$/.test(s);
};
function dropLoneSurrogates(s) {
    return s
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
function attachmentNameParams(filename) {
    const clean = dropLoneSurrogates((filename || 'attachment').replace(/["\r\n\\]/g, '_'));
    if (isAscii(clean)) {
        return { asciiName: clean || 'attachment', filenameParam: '' };
    }
    const ext = /(\.[A-Za-z0-9]{1,8})$/.exec(clean)?.[1] ?? '';
    return {
        asciiName: `attachment${ext}`,
        filenameParam: `; filename*=UTF-8''${encodeURIComponent(clean)}`,
    };
}
//# sourceMappingURL=attachment-name.util.js.map