"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeMime = sanitizeMime;
exports.sanitizeFilename = sanitizeFilename;
exports.verifyQueryToken = verifyQueryToken;
exports.streamAttachment = streamAttachment;
exports.transcodeAudioToMp3 = transcodeAudioToMp3;
const child_process_1 = require("child_process");
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const jwt = __importStar(require("jsonwebtoken"));
const common_1 = require("@nestjs/common");
function sanitizeMime(mime) {
    return mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime)
        ? mime
        : 'application/octet-stream';
}
function sanitizeFilename(name) {
    return (name ?? 'attachment').replace(/["\r\n\\/]/g, '_').slice(0, 255);
}
function verifyQueryToken(token) {
    try {
        jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
    }
    catch {
        throw new common_1.UnauthorizedException();
    }
}
function streamAttachment(res, buf, mimeType, filename, disposition, range) {
    const dispositionType = disposition === 'attachment' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', sanitizeMime(mimeType));
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${sanitizeFilename(filename)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const total = buf.length;
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (match && (match[1] || match[2])) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : total - 1;
        if (Number.isNaN(start))
            start = 0;
        if (Number.isNaN(end) || end >= total)
            end = total - 1;
        if (start > end || start >= total) {
            res.status(416);
            res.setHeader('Content-Range', `bytes */${total}`);
            res.end();
            return;
        }
        const chunk = buf.subarray(start, end + 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', chunk.length);
        res.end(chunk);
        return;
    }
    res.setHeader('Content-Length', total);
    res.end(buf);
}
async function transcodeAudioToMp3(input) {
    if (!ffmpeg_static_1.default)
        throw new Error('ffmpeg binary not available');
    const bin = ffmpeg_static_1.default;
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(bin, [
            '-i',
            'pipe:0',
            '-vn',
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
            '-f',
            'mp3',
            'pipe:1',
        ]);
        const chunks = [];
        let stderr = '';
        proc.stdout.on('data', (d) => chunks.push(d));
        proc.stderr.on('data', (d) => {
            stderr += d.toString();
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0 && chunks.length)
                resolve(Buffer.concat(chunks));
            else
                reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
        });
        proc.stdin.on('error', () => {
        });
        proc.stdin.write(input);
        proc.stdin.end();
    });
}
//# sourceMappingURL=attachment-stream.util.js.map