"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCREEN_TIMEOUT_SEC = exports.ACCEPT_DIGIT = void 0;
exports.spokenDigits = spokenDigits;
exports.whisperText = whisperText;
exports.whisperRepeat = whisperRepeat;
exports.whisperDoc = whisperDoc;
const laml_util_js_1 = require("./laml.util.js");
exports.ACCEPT_DIGIT = '1';
exports.SCREEN_TIMEOUT_SEC = 8;
function spokenDigits(e164) {
    if (!e164)
        return '';
    const digits = e164.replace(/\D/g, '');
    if (!digits)
        return '';
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    return local.split('').join(' ');
}
function whisperText(input) {
    const caller = input.fromName?.trim() || spokenDigits(input.from);
    const who = caller ? ` from ${caller}` : '';
    const lead = input.companyName
        ? `Call for ${input.companyName}${who}.`
        : `You have a business call${who}.`;
    return `${lead} Press ${exports.ACCEPT_DIGIT} to accept.`;
}
function whisperRepeat() {
    return `Press ${exports.ACCEPT_DIGIT} to accept.`;
}
function whisperDoc(input) {
    const { action, voice } = input;
    return (0, laml_util_js_1.response)((0, laml_util_js_1.pauseVerb)(1) +
        (0, laml_util_js_1.gatherVerb)((0, laml_util_js_1.sayVerb)(whisperText(input), { voice }) +
            (0, laml_util_js_1.sayVerb)(whisperRepeat(), { voice }), {
            input: 'dtmf',
            numDigits: 1,
            timeout: exports.SCREEN_TIMEOUT_SEC,
            action,
        }) +
        (0, laml_util_js_1.hangupVerb)());
}
//# sourceMappingURL=call-screen.util.js.map