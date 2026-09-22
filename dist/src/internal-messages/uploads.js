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
exports.MESSAGE_MULTER_LIMITS = exports.MAX_ATTACHMENT_BYTES = exports.MESSAGES_STAGING_SUBDIR = exports.MESSAGES_SUBDIR = exports.UPLOADS_ROOT = void 0;
exports.ensureUploadDirs = ensureUploadDirs;
exports.resolveStoredPath = resolveStoredPath;
const fs_1 = require("fs");
const path = __importStar(require("path"));
exports.UPLOADS_ROOT = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');
exports.MESSAGES_SUBDIR = 'messages';
exports.MESSAGES_STAGING_SUBDIR = 'messages-staging';
const MESSAGES_STAGING_DIR = path.join(exports.UPLOADS_ROOT, exports.MESSAGES_STAGING_SUBDIR);
exports.MAX_ATTACHMENT_BYTES = 250 * 1024 * 1024;
exports.MESSAGE_MULTER_LIMITS = {
    fileSize: exports.MAX_ATTACHMENT_BYTES,
    fieldSize: 25 * 1024 * 1024,
};
function ensureUploadDirs() {
    if (!(0, fs_1.existsSync)(MESSAGES_STAGING_DIR)) {
        (0, fs_1.mkdirSync)(MESSAGES_STAGING_DIR, { recursive: true });
    }
}
function resolveStoredPath(storagePath) {
    const abs = path.resolve(exports.UPLOADS_ROOT, storagePath);
    const root = path.resolve(exports.UPLOADS_ROOT);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        throw new Error('Attachment path escapes the uploads root');
    }
    return abs;
}
//# sourceMappingURL=uploads.js.map