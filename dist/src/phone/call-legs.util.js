"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickConnectedChild = pickConnectedChild;
exports.conferenceRoomFor = conferenceRoomFor;
exports.rootSidFromRoom = rootSidFromRoom;
exports.classifyLegs = classifyLegs;
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
//# sourceMappingURL=call-legs.util.js.map