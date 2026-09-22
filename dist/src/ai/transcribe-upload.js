"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRANSCRIBE_BYTES = void 0;
exports.transcribeFileFilter = transcribeFileFilter;
const common_1 = require("@nestjs/common");
exports.MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
    'audio/webm',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/m4a',
    'audio/x-m4a',
]);
function transcribeFileFilter(_req, file, cb) {
    const base = (file.mimetype || '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (ALLOWED.has(base) || base.startsWith('audio/'))
        return cb(null, true);
    cb(new common_1.BadRequestException('That is not an audio recording.'), false);
}
//# sourceMappingURL=transcribe-upload.js.map