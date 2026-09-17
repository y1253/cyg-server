"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPLICITLY_READ_SQL = void 0;
exports.isImplicitlyReadInternalCall = isImplicitlyReadInternalCall;
const phone_timeline_util_js_1 = require("../phone/phone-timeline.util.js");
function isImplicitlyReadInternalCall(direction, outcome) {
    if (direction === 'outbound')
        return true;
    switch (outcome) {
        case 'answered':
        case 'in-progress':
            return true;
        case 'missed':
            return false;
        default: {
            const never = outcome;
            return never;
        }
    }
}
exports.IMPLICITLY_READ_SQL = {
    AND: [{ status: { notIn: [...phone_timeline_util_js_1.UNCONNECTED] } }, { durationSec: { gt: 0 } }],
};
//# sourceMappingURL=internal-call-read.util.js.map