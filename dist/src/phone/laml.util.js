"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esc = esc;
exports.emptyResponse = emptyResponse;
exports.say = say;
exports.sayAndHangup = sayAndHangup;
exports.hangup = hangup;
exports.dialSip = dialSip;
exports.dialNumber = dialNumber;
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function response(children) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${children}</Response>`;
}
function emptyResponse() {
    return response('');
}
function say(text, opts = {}) {
    const voice = opts.voice ? ` voice="${esc(opts.voice)}"` : '';
    return response(`<Say${voice}>${esc(text)}</Say>`);
}
function sayAndHangup(text, opts = {}) {
    const voice = opts.voice ? ` voice="${esc(opts.voice)}"` : '';
    return response(`<Say${voice}>${esc(text)}</Say><Hangup/>`);
}
function hangup() {
    return response('<Hangup/>');
}
function sipNoun(target) {
    const params = Object.entries(target.headers ?? {})
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `<Sip>${esc(`sip:${target.uri}${params ? `?${params}` : ''}`)}</Sip>`;
}
function dialAttrs(opts) {
    return [
        opts.timeout !== undefined ? ` timeout="${esc(opts.timeout)}"` : '',
        opts.callerId ? ` callerId="${esc(opts.callerId)}"` : '',
        opts.action ? ` action="${esc(opts.action)}"` : '',
    ].join('');
}
function dialSip(targets, opts = {}) {
    return response(`<Dial${dialAttrs(opts)}>${targets.map(sipNoun).join('')}</Dial>`);
}
function dialNumber(e164, opts = {}) {
    return response(`<Dial${dialAttrs(opts)}><Number>${esc(e164)}</Number></Dial>`);
}
//# sourceMappingURL=laml.util.js.map