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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PhoneAudioService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneAudioService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const uploads_js_1 = require("../internal-messages/uploads.js");
const phone_audio_storage_js_1 = require("./phone-audio.storage.js");
const phone_audio_util_js_1 = require("./phone-audio.util.js");
let PhoneAudioService = PhoneAudioService_1 = class PhoneAudioService {
    prisma;
    logger = new common_1.Logger(PhoneAudioService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list() {
        const rows = await this.prisma.phoneAudio.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r) => this.toView(r));
    }
    async create(file, name, uploadedById) {
        let mp3;
        let durationMs;
        try {
            ({ mp3, durationMs } = await (0, phone_audio_util_js_1.transcodeToTelephonyMp3)(file.buffer));
        }
        catch (err) {
            this.logger.warn(`phone-audio transcode failed for "${file.originalname}": ${String(err)}`);
            throw new common_1.BadRequestException('That file could not be read as audio. Try an MP3 or WAV.');
        }
        const storagePath = (0, phone_audio_storage_js_1.newAudioStoragePath)();
        (0, phone_audio_storage_js_1.ensurePhoneAudioDir)();
        await (0, promises_1.writeFile)((0, uploads_js_1.resolveStoredPath)(storagePath), mp3);
        const row = await this.prisma.phoneAudio.create({
            data: {
                name: (name ?? '').trim() || this.defaultName(file.originalname),
                filename: file.originalname,
                mimeType: 'audio/mpeg',
                size: mp3.length,
                durationMs,
                storagePath,
                uploadedById,
            },
        });
        this.logger.log(`phone-audio uploaded id=${row.id} "${row.name}" ${mp3.length}B ${durationMs}ms`);
        return this.toView(row);
    }
    async rename(id, name) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new common_1.BadRequestException('Name cannot be empty');
        await this.getOrThrow(id);
        const row = await this.prisma.phoneAudio.update({
            where: { id },
            data: { name: trimmed },
        });
        return this.toView(row);
    }
    async remove(id) {
        await this.getOrThrow(id);
        await this.prisma.phoneAudio.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    async resolve(settingValue) {
        const id = (0, phone_audio_util_js_1.audioIdOrNone)(settingValue);
        if (id === null)
            return null;
        const row = await this.prisma.phoneAudio.findFirst({
            where: { id, deletedAt: null },
        });
        if (!row) {
            this.logger.warn(`phone-audio id=${id} is referenced by settings but unavailable`);
            return null;
        }
        return row;
    }
    async streamable(id) {
        const row = await this.getOrThrow(id);
        return {
            absolutePath: (0, uploads_js_1.resolveStoredPath)(row.storagePath),
            mimeType: row.mimeType,
            filename: `${row.name}.mp3`,
        };
    }
    async getOrThrow(id) {
        const row = await this.prisma.phoneAudio.findFirst({
            where: { id, deletedAt: null },
        });
        if (!row)
            throw new common_1.NotFoundException('Audio not found');
        return row;
    }
    defaultName(originalname) {
        const base = path.basename(originalname, path.extname(originalname)).trim();
        return base.slice(0, 80) || 'Untitled';
    }
    toView(row) {
        return {
            id: row.id,
            name: row.name,
            filename: row.filename,
            size: row.size,
            durationMs: row.durationMs,
            createdAt: row.createdAt,
        };
    }
};
exports.PhoneAudioService = PhoneAudioService;
exports.PhoneAudioService = PhoneAudioService = PhoneAudioService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], PhoneAudioService);
//# sourceMappingURL=phone-audio.service.js.map