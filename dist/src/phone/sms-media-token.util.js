"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signSmsMediaToken = signSmsMediaToken;
exports.assertSmsMediaToken = assertSmsMediaToken;
const common_1 = require("@nestjs/common");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const TTL_SECONDS = 3600;
function signSmsMediaToken(messageSid, mediaSid) {
    return jsonwebtoken_1.default.sign({ msg: messageSid, med: mediaSid }, process.env.JWT_SECRET ?? 'secret', { expiresIn: TTL_SECONDS });
}
function assertSmsMediaToken(token, messageSid, mediaSid) {
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
    }
    catch {
        throw new common_1.UnauthorizedException();
    }
    if (payload.msg !== messageSid || payload.med !== mediaSid) {
        throw new common_1.UnauthorizedException();
    }
}
//# sourceMappingURL=sms-media-token.util.js.map