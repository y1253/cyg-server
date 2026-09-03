"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esc = esc;
exports.response = response;
exports.emptyResponse = emptyResponse;
exports.sayVerb = sayVerb;
exports.hangupVerb = hangupVerb;
exports.say = say;
exports.sayAndHangup = sayAndHangup;
exports.hangup = hangup;
exports.dialSipVerb = dialSipVerb;
exports.dialSip = dialSip;
exports.dialNumberVerb = dialNumberVerb;
exports.dialNumber = dialNumber;
exports.sayThenDialSip = sayThenDialSip;
exports.recordVerb = recordVerb;
exports.record = record;
exports.sayThenRecord = sayThenRecord;
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
function sayVerb(text, opts = {}) {
    const voice = opts.voice ? ` voice="${esc(opts.voice)}"` : '';
    return `<Say${voice}>${esc(text)}</Say>`;
}
function hangupVerb() {
    return '<Hangup/>';
}
function say(text, opts = {}) {
    return response(sayVerb(text, opts));
}
function sayAndHangup(text, opts = {}) {
    return response(sayVerb(text, opts) + hangupVerb());
}
function hangup() {
    return response(hangupVerb());
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
        opts.record ? ` record="${esc(opts.record)}"` : '',
    ].join('');
}
function dialSipVerb(targets, opts = {}) {
    return `<Dial${dialAttrs(opts)}>${targets.map(sipNoun).join('')}</Dial>`;
}
function dialSip(targets, opts = {}) {
    return response(dialSipVerb(targets, opts));
}
function dialNumberVerb(e164, opts = {}) {
    return `<Dial${dialAttrs(opts)}><Number>${esc(e164)}</Number></Dial>`;
}
function dialNumber(e164, opts = {}) {
    return response(dialNumberVerb(e164, opts));
}
function sayThenDialSip(text, targets, opts = {}) {
    const { voice, ...dial } = opts;
    return response((text ? sayVerb(text, { voice }) : '') + dialSipVerb(targets, dial));
}
function recordAttrs(opts) {
    return [
        opts.action ? ` action="${esc(opts.action)}"` : '',
        opts.maxLength !== undefined ? ` maxLength="${esc(opts.maxLength)}"` : '',
        opts.timeout !== undefined ? ` timeout="${esc(opts.timeout)}"` : '',
        opts.finishOnKey ? ` finishOnKey="${esc(opts.finishOnKey)}"` : '',
        opts.playBeep !== undefined ? ` playBeep="${esc(opts.playBeep)}"` : '',
    ].join('');
}
function recordVerb(opts = {}) {
    return `<Record${recordAttrs(opts)}/>`;
}
function record(opts = {}) {
    return response(recordVerb(opts));
}
function sayThenRecord(text, opts = {}) {
    const { voice, ...rec } = opts;
    return response((text ? sayVerb(text, { voice }) : '') + recordVerb(rec));
}
//# sourceMappingURL=laml.util.js.map