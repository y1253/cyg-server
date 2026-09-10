"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPT_IN_REPLY = exports.HELP_REPLY = exports.OPT_OUT_REPLY = void 0;
exports.classifyInboundSms = classifyInboundSms;
exports.replyFor = replyFor;
const STOP_WORDS = new Set([
    'STOP',
    'UNSUBSCRIBE',
    'END',
    'QUIT',
    'CANCEL',
    'STOPALL',
    'OPTOUT',
    'REVOKE',
]);
const HELP_WORDS = new Set(['HELP', 'INFO']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);
exports.OPT_OUT_REPLY = 'CYG Finance: You have been unsubscribed and will receive no further text messages ' +
    'from us. For help, email office@cygfinance.com or call 855-294-3462.';
exports.HELP_REPLY = 'CYG Finance bookkeeping account messages. For help, email office@cygfinance.com or ' +
    'call 855-294-3462. Msg&data rates may apply. Reply STOP to unsubscribe.';
exports.OPT_IN_REPLY = 'CYG Finance: You are now subscribed to bookkeeping account messages. Msg frequency ' +
    'varies. Msg&data rates may apply. Reply HELP for help, STOP to unsubscribe.';
function classifyInboundSms(body) {
    if (typeof body !== 'string')
        return null;
    const word = body
        .trim()
        .replace(/^[\s"'“”‘’.,!?-]+/u, '')
        .replace(/[\s"'“”‘’.,!?-]+$/u, '')
        .toUpperCase();
    if (!word)
        return null;
    if (STOP_WORDS.has(word))
        return 'stop';
    if (HELP_WORDS.has(word))
        return 'help';
    if (START_WORDS.has(word))
        return 'start';
    return null;
}
function replyFor(keyword) {
    switch (keyword) {
        case 'stop':
            return exports.OPT_OUT_REPLY;
        case 'help':
            return exports.HELP_REPLY;
        case 'start':
            return exports.OPT_IN_REPLY;
    }
}
//# sourceMappingURL=sms-keywords.util.js.map