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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTBOUND_MULTER_LIMITS = exports.outboundAttachmentStorage = exports.INLINE_BUDGET_BYTES = exports.MAX_OUTBOUND_FILE_BYTES = exports.MAX_ATTACHMENTS = exports.OUTBOUND_SUBDIR = void 0;
exports.ensureOutboundDir = ensureOutboundDir;
exports.splitBySizeBudget = splitBySizeBudget;
exports.discardOutboundFiles = discardOutboundFiles;
exports.sweepStaleOutboundFiles = sweepStaleOutboundFiles;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const multer_1 = require("multer");
const uploads_js_1 = require("../internal-messages/uploads.js");
exports.OUTBOUND_SUBDIR = 'outbound';
const OUTBOUND_DIR = path.join(uploads_js_1.UPLOADS_ROOT, exports.OUTBOUND_SUBDIR);
exports.MAX_ATTACHMENTS = 10;
exports.MAX_OUTBOUND_FILE_BYTES = 250 * 1024 * 1024;
exports.INLINE_BUDGET_BYTES = 18 * 1024 * 1024;
function ensureOutboundDir() {
    if (!(0, fs_1.existsSync)(OUTBOUND_DIR))
        (0, fs_1.mkdirSync)(OUTBOUND_DIR, { recursive: true });
}
exports.outboundAttachmentStorage = (0, multer_1.diskStorage)({
    destination: (_req, _file, cb) => {
        ensureOutboundDir();
        cb(null, OUTBOUND_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).slice(0, 12);
        const safeExt = /^\.[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : '';
        cb(null, `${(0, crypto_1.randomUUID)()}${safeExt}`);
    },
});
exports.OUTBOUND_MULTER_LIMITS = {
    fileSize: exports.MAX_OUTBOUND_FILE_BYTES,
    fieldSize: 25 * 1024 * 1024,
};
function splitBySizeBudget(files, budget = exports.INLINE_BUDGET_BYTES) {
    const position = new Map(files.map((f, i) => [f, i]));
    const biggestFirst = [...files].sort((a, b) => b.size - a.size || position.get(a) - position.get(b));
    const linked = new Set();
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of biggestFirst) {
        if (total <= budget)
            break;
        linked.add(f);
        total -= f.size;
    }
    return {
        inline: files.filter((f) => !linked.has(f)),
        linked: files.filter((f) => linked.has(f)),
    };
}
async function discardOutboundFiles(files) {
    await Promise.all((files ?? []).map(async (f) => {
        if (!f?.path)
            return;
        try {
            await (0, promises_1.unlink)(f.path);
        }
        catch {
        }
    }));
}
async function sweepStaleOutboundFiles(maxAgeMs = 60 * 60 * 1000) {
    let removed = 0;
    try {
        const names = await (0, promises_1.readdir)(OUTBOUND_DIR);
        const cutoff = Date.now() - maxAgeMs;
        for (const name of names) {
            const full = path.join(OUTBOUND_DIR, name);
            try {
                const info = await (0, promises_1.stat)(full);
                if (info.isFile() && info.mtimeMs < cutoff) {
                    await (0, promises_1.unlink)(full);
                    removed++;
                }
            }
            catch {
            }
        }
    }
    catch {
    }
    return removed;
}
//# sourceMappingURL=outbound-uploads.js.map