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
exports.MMS_STALE_MS = exports.MAX_MMS_UPLOAD_BYTES = exports.MAX_MMS_TOTAL_BYTES = exports.MAX_MMS_FILES = exports.MMS_DIR = exports.MMS_SUBDIR = void 0;
exports.ensureMmsDir = ensureMmsDir;
exports.signMmsToken = signMmsToken;
exports.assertMmsToken = assertMmsToken;
exports.resolveStagedMms = resolveStagedMms;
exports.discardStagedMms = discardStagedMms;
exports.sweepStaleMmsFiles = sweepStaleMmsFiles;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const common_1 = require("@nestjs/common");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uploads_js_1 = require("../internal-messages/uploads.js");
exports.MMS_SUBDIR = 'mms';
exports.MMS_DIR = path.join(uploads_js_1.UPLOADS_ROOT, exports.MMS_SUBDIR);
exports.MAX_MMS_FILES = 3;
exports.MAX_MMS_TOTAL_BYTES = 1024 * 1024;
exports.MAX_MMS_UPLOAD_BYTES = 25 * 1024 * 1024;
exports.MMS_STALE_MS = 6 * 60 * 60 * 1000;
const TOKEN_TTL_SECONDS = 15 * 60;
function ensureMmsDir() {
    if (!(0, fs_1.existsSync)(exports.MMS_DIR))
        (0, fs_1.mkdirSync)(exports.MMS_DIR, { recursive: true });
}
function signMmsToken(filename) {
    return jsonwebtoken_1.default.sign({ mms: filename }, process.env.JWT_SECRET ?? 'secret', {
        expiresIn: TOKEN_TTL_SECONDS,
    });
}
function assertMmsToken(token, filename) {
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
    }
    catch {
        throw new common_1.UnauthorizedException();
    }
    if (payload.mms !== filename)
        throw new common_1.UnauthorizedException();
}
function resolveStagedMms(filename) {
    if (!/^[0-9a-f-]{36}(\.[A-Za-z0-9]{1,12})?$/.test(filename))
        return null;
    const absolute = path.join(exports.MMS_DIR, filename);
    return path.resolve(absolute).startsWith(path.resolve(exports.MMS_DIR))
        ? absolute
        : null;
}
async function discardStagedMms(paths) {
    await Promise.all(paths.map((p) => (0, promises_1.rm)(p, { force: true }).catch(() => undefined)));
}
async function sweepStaleMmsFiles(maxAgeMs = exports.MMS_STALE_MS) {
    if (!(0, fs_1.existsSync)(exports.MMS_DIR))
        return 0;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const name of await (0, promises_1.readdir)(exports.MMS_DIR).catch(() => [])) {
        const absolute = path.join(exports.MMS_DIR, name);
        try {
            const info = await (0, promises_1.stat)(absolute);
            if (info.mtimeMs < cutoff) {
                await (0, promises_1.rm)(absolute, { force: true });
                removed++;
            }
        }
        catch {
        }
    }
    return removed;
}
//# sourceMappingURL=mms-staging.util.js.map