"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signRecordingToken = signRecordingToken;
exports.assertRecordingToken = assertRecordingToken;
const common_1 = require("@nestjs/common");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const TTL_SECONDS = 3600;
function signRecordingToken(sid) {
    return jsonwebtoken_1.default.sign({ rec: sid }, process.env.JWT_SECRET ?? 'secret', {
        expiresIn: TTL_SECONDS,
    });
}
function assertRecordingToken(token, sid) {
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
    }
    catch {
        throw new common_1.UnauthorizedException();
    }
    if (payload.rec !== sid)
        throw new common_1.UnauthorizedException();
}
//# sourceMappingURL=recording-token.util.js.map