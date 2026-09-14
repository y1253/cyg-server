"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_RETRY_MS = exports.LIVE_LOOKBACK_MS = exports.CLEAR_GRACE_MS = exports.RECONCILE_EVERY_MS = exports.ACTIVE_CALL_TTL_MS = void 0;
exports.isExpired = isExpired;
exports.needsReconcile = needsReconcile;
exports.shouldClear = shouldClear;
exports.liveOnly = liveOnly;
exports.entryFromLiveRow = entryFromLiveRow;
exports.elapsedSecOf = elapsedSecOf;
exports.toView = toView;
exports.busyMessage = busyMessage;
const phone_timeline_util_js_1 = require("./phone-timeline.util.js");
exports.ACTIVE_CALL_TTL_MS = 4 * 60 * 60 * 1000;
exports.RECONCILE_EVERY_MS = 30_000;
exports.CLEAR_GRACE_MS = 10_000;
exports.LIVE_LOOKBACK_MS = 10_000;
exports.TERMINAL_RETRY_MS = 5_000;
function isExpired(entry, now) {
    return now - entry.startedAt > exports.ACTIVE_CALL_TTL_MS;
}
function needsReconcile(entry, now) {
    return now - entry.verifiedAt > exports.RECONCILE_EVERY_MS;
}
function shouldClear(entry, liveCount, now) {
    if (entry.state === 'dialing')
        return false;
    if (now - entry.startedAt < exports.CLEAR_GRACE_MS)
        return false;
    return liveCount === 0;
}
function liveOnly(rows) {
    return rows.filter((row) => phone_timeline_util_js_1.LIVE.has(row.status));
}
function entryFromLiveRow(companyId, supportNumber, row, now) {
    const inbound = (0, phone_timeline_util_js_1.legNumber)(row.to) === supportNumber;
    const started = typeof row.startedAt === 'number' && row.startedAt > 0 ? row.startedAt : now;
    return {
        companyId,
        supportNumber,
        callSid: row.sid,
        direction: inbound ? 'inbound' : 'outbound',
        state: 'active',
        userId: null,
        userName: null,
        peer: (0, phone_timeline_util_js_1.legNumber)(inbound ? row.from : row.to) ?? '',
        peerName: null,
        startedAt: started,
        answeredAt: null,
        verifiedAt: now,
    };
}
function elapsedSecOf(entry, now) {
    const from = entry.answeredAt ?? entry.startedAt;
    return Math.max(0, Math.floor((now - from) / 1000));
}
function toView(entry, now, viewerId) {
    return {
        companyId: entry.companyId,
        callSid: entry.callSid,
        direction: entry.direction,
        state: entry.state,
        userName: entry.userName,
        isViewer: entry.userId !== null && entry.userId === viewerId,
        peer: entry.peer,
        peerName: entry.peerName,
        elapsedSec: elapsedSecOf(entry, now),
    };
}
function busyMessage(companyName, entry, now) {
    const what = entry.direction === 'inbound'
        ? entry.state === 'ringing'
            ? 'an incoming call is ringing'
            : 'an inbound call is in progress'
        : 'an outbound call is in progress';
    const who = entry.userName ? ` (${entry.userName})` : '';
    const minutes = Math.floor(elapsedSecOf(entry, now) / 60);
    const since = minutes >= 1 ? `, ${minutes} min so far` : '';
    return `${companyName}'s line is busy: ${what}${who}${since}. Try again when it ends.`;
}
//# sourceMappingURL=active-calls.util.js.map