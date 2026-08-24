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
exports.verifyQueryTokenUser = verifyQueryTokenUser;
exports.streamAttachment = streamAttachment;
exports.streamAttachmentFile = streamAttachmentFile;
exports.transcodeAudioToMp3 = transcodeAudioToMp3;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const jwt = __importStar(require("jsonwebtoken"));
const common_1 = require("@nestjs/common");
const attachment_name_util_js_1 = require("./attachment-name.util.js");
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
function verifyQueryTokenUser(token) {
    try {
        const payload = jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
        const userId = Number(payload.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new Error('bad subject');
        }
        return userId;
    }
    catch {
        throw new common_1.UnauthorizedException();
    }
}
function parseRange(range, total) {
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (!match || (!match[1] && !match[2]))
        return null;
    if (total === 0)
        return 'unsatisfiable';
    if (!match[1]) {
        const suffix = parseInt(match[2], 10);
        if (Number.isNaN(suffix) || suffix === 0)
            return 'unsatisfiable';
        return { start: Math.max(0, total - suffix), end: total - 1 };
    }
    let start = parseInt(match[1], 10);
    let end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start))
        start = 0;
    if (Number.isNaN(end) || end >= total)
        end = total - 1;
    if (start > end || start >= total)
        return 'unsatisfiable';
    return { start, end };
}
function setAttachmentHeaders(res, mimeType, filename, disposition) {
    const dispositionType = disposition === 'attachment' ? 'attachment' : 'inline';
    const { asciiName, filenameParam } = (0, attachment_name_util_js_1.attachmentNameParams)(sanitizeFilename(filename));
    res.setHeader('Content-Type', sanitizeMime(mimeType));
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${asciiName}"${filenameParam}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
}
function streamAttachment(res, buf, mimeType, filename, disposition, range) {
    setAttachmentHeaders(res, mimeType, filename, disposition);
    const total = buf.length;
    const wanted = parseRange(range, total);
    if (wanted === 'unsatisfiable') {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
    }
    if (wanted) {
        const chunk = buf.subarray(wanted.start, wanted.end + 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${wanted.start}-${wanted.end}/${total}`);
        res.setHeader('Content-Length', chunk.length);
        res.end(chunk);
        return;
    }
    res.setHeader('Content-Length', total);
    res.end(buf);
}
async function streamAttachmentFile(res, absolutePath, mimeType, filename, disposition, range) {
    let total;
    try {
        total = (await (0, promises_1.stat)(absolutePath)).size;
    }
    catch {
        throw new common_1.NotFoundException('Attachment file is missing');
    }
    setAttachmentHeaders(res, mimeType, filename, disposition);
    const wanted = parseRange(range, total);
    if (wanted === 'unsatisfiable') {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
    }
    if (wanted) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${wanted.start}-${wanted.end}/${total}`);
        res.setHeader('Content-Length', wanted.end - wanted.start + 1);
    }
    else {
        res.setHeader('Content-Length', total);
    }
    const stream = (0, fs_1.createReadStream)(absolutePath, {
        start: wanted ? wanted.start : 0,
        end: wanted ? wanted.end : undefined,
    });
    res.on('close', () => stream.destroy());
    stream.on('error', () => {
        res.destroy();
    });
    stream.pipe(res);
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