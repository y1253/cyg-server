"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAudioToken = signAudioToken;
exports.isAudioTokenFor = isAudioTokenFor;
exports.assertAudioToken = assertAudioToken;
const common_1 = require("@nestjs/common");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const TTL_SECONDS = 6 * 3600;
function signAudioToken(audioId) {
    return jsonwebtoken_1.default.sign({ aud_id: audioId }, process.env.JWT_SECRET ?? 'secret', {
        expiresIn: TTL_SECONDS,
    });
}
function isAudioTokenFor(token, audioId) {
    try {
        const payload = jsonwebtoken_1.default.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
        return payload.aud_id === audioId;
    }
    catch {
        return false;
    }
}
function assertAudioToken(token, audioId) {
    if (!isAudioTokenFor(token, audioId))
        throw new common_1.UnauthorizedException();
}
//# sourceMappingURL=phone-audio-token.util.js.map