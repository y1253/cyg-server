"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smsItemId = exports.callItemId = exports.SMS_ID_PREFIX = exports.CALL_ID_PREFIX = void 0;
exports.isPhoneItemId = isPhoneItemId;
exports.e164FromSipUri = e164FromSipUri;
exports.legNumber = legNumber;
exports.counterpartyOfCall = counterpartyOfCall;
exports.counterpartyOfMessage = counterpartyOfMessage;
exports.callOutcome = callOutcome;
exports.buildPhoneItems = buildPhoneItems;
const signalwire_parse_js_1 = require("./signalwire-parse.js");
exports.CALL_ID_PREFIX = 'swcall:';
exports.SMS_ID_PREFIX = 'swsms:';
const callItemId = (sid) => `${exports.CALL_ID_PREFIX}${sid}`;
exports.callItemId = callItemId;
const smsItemId = (sid) => `${exports.SMS_ID_PREFIX}${sid}`;
exports.smsItemId = smsItemId;
function isPhoneItemId(value) {
    return (typeof value === 'string' &&
        /^sw(call|sms):[A-Za-z0-9_.-]{1,120}$/.test(value));
}
function e164FromSipUri(value) {
    if (!value)
        return null;
    const match = /^sips?:(\+[1-9]\d{7,14})@/i.exec(value.trim());
    return match ? match[1] : null;
}
function legNumber(value) {
    if (!value)
        return null;
    const trimmed = value.trim();
    return (0, signalwire_parse_js_1.isE164)(trimmed) ? trimmed : e164FromSipUri(trimmed);
}
function counterpartyOfCall(call, supportNumber) {
    if (call.to === supportNumber && (0, signalwire_parse_js_1.isE164)(call.from)) {
        return { counterparty: call.from, direction: 'inbound' };
    }
    if (call.from === supportNumber && (0, signalwire_parse_js_1.isE164)(call.to)) {
        return { counterparty: call.to, direction: 'outbound' };
    }
    return null;
}
function counterpartyOfMessage(msg, supportNumber) {
    if (msg.to === supportNumber && (0, signalwire_parse_js_1.isE164)(msg.from)) {
        return { counterparty: msg.from, direction: 'inbound' };
    }
    if (msg.from === supportNumber && (0, signalwire_parse_js_1.isE164)(msg.to)) {
        return { counterparty: msg.to, direction: 'outbound' };
    }
    return null;
}
const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);
const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);
function callOutcome(call, direction, child) {
    if (LIVE.has(call.status))
        return 'in-progress';
    if (direction === 'inbound') {
        if (!child)
            return 'missed';
        if (UNCONNECTED.has(child.status))
            return 'missed';
        if (child.status === 'failed')
            return 'failed';
        return child.durationSec > 0 ? 'answered' : 'missed';
    }
    if (call.status === 'failed')
        return 'failed';
    if (UNCONNECTED.has(call.status))
        return 'missed';
    return call.durationSec > 0 ? 'answered' : 'missed';
}
function buildPhoneItems(input) {
    const { supportNumber, calls, sipLegs, messages, recordedCallSids, readIds, completedIds, } = input;
    const childByParent = new Map();
    const childSidsByParent = new Map();
    for (const leg of sipLegs) {
        if (!leg.parentCallSid)
            continue;
        const existing = childByParent.get(leg.parentCallSid);
        if (!existing || (existing.durationSec === 0 && leg.durationSec > 0)) {
            childByParent.set(leg.parentCallSid, leg);
        }
        const sids = childSidsByParent.get(leg.parentCallSid) ?? [];
        sids.push(leg.sid);
        childSidsByParent.set(leg.parentCallSid, sids);
    }
    const hasRecordingFor = (call) => {
        if (recordedCallSids.has(call.sid))
            return true;
        if (call.parentCallSid && recordedCallSids.has(call.parentCallSid))
            return true;
        return (childSidsByParent.get(call.sid) ?? []).some((sid) => recordedCallSids.has(sid));
    };
    const items = [];
    const seen = new Set();
    for (const call of calls) {
        const id = (0, exports.callItemId)(call.sid);
        if (seen.has(id))
            continue;
        const resolved = counterpartyOfCall(call, supportNumber);
        if (!resolved)
            continue;
        seen.add(id);
        const outcome = callOutcome(call, resolved.direction, childByParent.get(call.sid));
        const recorded = hasRecordingFor(call);
        const item = {
            id,
            sid: call.sid,
            kind: 'call',
            direction: resolved.direction,
            counterparty: resolved.counterparty,
            supportNumber,
            status: call.status,
            parentCallSid: call.parentCallSid,
            outcome,
            durationSec: call.durationSec,
            hasRecording: recorded,
            hasVoicemail: resolved.direction === 'inbound' && outcome === 'missed' && recorded,
            at: new Date(call.startedAt).toISOString(),
            isRead: resolved.direction === 'outbound' || readIds.has(id),
            isCompleted: completedIds.has(id),
        };
        items.push(item);
    }
    for (const msg of messages) {
        const id = (0, exports.smsItemId)(msg.sid);
        if (seen.has(id))
            continue;
        const resolved = counterpartyOfMessage(msg, supportNumber);
        if (!resolved)
            continue;
        seen.add(id);
        const item = {
            id,
            sid: msg.sid,
            kind: 'sms',
            direction: resolved.direction,
            counterparty: resolved.counterparty,
            supportNumber,
            body: msg.body,
            numMedia: msg.numMedia,
            status: msg.status,
            errorCode: msg.errorCode,
            at: new Date(msg.sentAt).toISOString(),
            isRead: (0, signalwire_parse_js_1.isOutbound)(msg.direction) || readIds.has(id),
            isCompleted: completedIds.has(id),
        };
        items.push(item);
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
//# sourceMappingURL=phone-timeline.util.js.map