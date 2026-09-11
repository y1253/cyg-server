"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ADDED_PARTIES = void 0;
exports.pickConnectedChild = pickConnectedChild;
exports.conferenceRoomFor = conferenceRoomFor;
exports.rootSidFromRoom = rootSidFromRoom;
exports.classifyLegs = classifyLegs;
exports.transferStateOf = transferStateOf;
exports.conferenceStateOf = conferenceStateOf;
const phone_timeline_util_js_1 = require("./phone-timeline.util.js");
function pickConnectedChild(children) {
    let best = null;
    for (const leg of children) {
        if (!best) {
            best = leg;
            continue;
        }
        if (best.status === 'in-progress')
            continue;
        if (leg.status === 'in-progress') {
            best = leg;
            continue;
        }
        if (best.durationSec === 0 && leg.durationSec > 0)
            best = leg;
    }
    return best;
}
function conferenceRoomFor(rootSid) {
    return `cyg-${rootSid}`;
}
function rootSidFromRoom(room) {
    return room.startsWith('cyg-') ? room.slice(4) : null;
}
function classifyLegs(root, children, kind, ctx = {}) {
    const child = pickConnectedChild(children)?.sid ?? null;
    switch (kind) {
        case 'inbound':
            return { rootSid: root.sid, agentSid: child, peerSid: root.sid };
        case 'outbound':
            return { rootSid: root.sid, agentSid: root.sid, peerSid: child };
        case 'internal': {
            const agentIsRoot = ctx.requesterIsCaller === true;
            return {
                rootSid: root.sid,
                agentSid: agentIsRoot ? root.sid : child,
                peerSid: agentIsRoot ? child : root.sid,
            };
        }
    }
}
function transferStateOf(peer, children, record) {
    if (!peer)
        return 'ended';
    const relevant = children.filter((c) => c.sid !== record.previousAgentSid && c.startedAt >= record.at);
    if (relevant.some((c) => c.status === 'in-progress'))
        return 'answered';
    if (relevant.length > 0 &&
        relevant.every((c) => phone_timeline_util_js_1.UNCONNECTED.has(c.status)) &&
        phone_timeline_util_js_1.LIVE.has(peer.status)) {
        return 'no-answer';
    }
    if (!phone_timeline_util_js_1.LIVE.has(peer.status))
        return 'ended';
    return 'ringing';
}
exports.MAX_ADDED_PARTIES = 4;
function conferenceStateOf(participants, record, liveLegSids) {
    const byLeg = new Map(participants.map((p) => [p.callSid, p]));
    const parties = record.parties.map((party) => {
        const row = byLeg.get(party.legSid);
        if (row) {
            return {
                id: party.id,
                label: party.label,
                state: row.hold ? 'held' : 'connected',
            };
        }
        return {
            id: party.id,
            label: party.label,
            state: liveLegSids.has(party.legSid) ? 'ringing' : 'gone',
        };
    });
    const present = parties.filter((p) => p.state !== 'gone');
    return {
        active: byLeg.has(record.agentSid),
        parties,
        merged: present.every((p) => p.state !== 'held'),
        canAdd: record.parties.length < exports.MAX_ADDED_PARTIES + 1,
        canSwap: present.length === 2,
    };
}
//# sourceMappingURL=call-legs.util.js.map