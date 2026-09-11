"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conferenceDoc = conferenceDoc;
const phone_config_js_1 = require("./phone.config.js");
const laml_util_js_1 = require("./laml.util.js");
const laml_util_js_2 = require("./laml.util.js");
function conferenceDoc(input) {
    const conf = {
        startOnEnter: true,
        endOnExit: input.role === 'agent',
        beep: input.role === 'agent' ? 'false' : 'onEnter',
        ...(input.holdUrl !== undefined && {
            waitUrl: input.holdUrl,
            waitMethod: 'POST',
        }),
        ...(input.statusCallback !== undefined && {
            statusCallback: input.statusCallback,
            statusCallbackEvent: 'start end join leave',
        }),
    };
    return (0, laml_util_js_2.response)((0, laml_util_js_1.conferenceVerb)(input.room, conf, {
        ...(input.isRoot && { record: (0, phone_config_js_1.recordMode)(input.env ?? process.env) }),
    }));
}
//# sourceMappingURL=conference-laml.util.js.map