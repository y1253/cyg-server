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
exports.signatureImageStorage = exports.SIGNATURE_IMAGE_MULTER_LIMITS = exports.MAX_IMAGE_BYTES = exports.SIGNATURE_IMAGE_DIR = exports.SIGNATURE_IMAGE_SUBDIR = void 0;
exports.imageFileFilter = imageFileFilter;
exports.ensureSignatureImageDir = ensureSignatureImageDir;
exports.newImageStoragePath = newImageStoragePath;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const multer_1 = require("multer");
const uploads_js_1 = require("../internal-messages/uploads.js");
exports.SIGNATURE_IMAGE_SUBDIR = 'signature-images';
exports.SIGNATURE_IMAGE_DIR = path.join(uploads_js_1.UPLOADS_ROOT, exports.SIGNATURE_IMAGE_SUBDIR);
exports.MAX_IMAGE_BYTES = 5 * 1024 * 1024;
exports.SIGNATURE_IMAGE_MULTER_LIMITS = {
    fileSize: exports.MAX_IMAGE_BYTES,
    files: 1,
};
function imageFileFilter(_req, file, cb) {
    const ok = file.mimetype.startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|bmp|tiff?|avif)$/i.test(file.originalname);
    if (!ok) {
        cb(new Error('Only image files can be uploaded here'), false);
        return;
    }
    cb(null, true);
}
exports.signatureImageStorage = (0, multer_1.memoryStorage)();
function ensureSignatureImageDir() {
    if (!(0, fs_1.existsSync)(exports.SIGNATURE_IMAGE_DIR))
        (0, fs_1.mkdirSync)(exports.SIGNATURE_IMAGE_DIR, { recursive: true });
}
function newImageStoragePath() {
    return `${exports.SIGNATURE_IMAGE_SUBDIR}/${(0, crypto_1.randomUUID)()}.png`;
}
//# sourceMappingURL=signature-image.storage.js.map