"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var SignatureImageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureImageService = void 0;
const promises_1 = require("fs/promises");
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const sharp_1 = __importDefault(require("sharp"));
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const uploads_js_1 = require("../internal-messages/uploads.js");
const company_target_util_js_1 = require("../companies/company-target.util.js");
const public_base_js_1 = require("../communications/public-base.js");
const email_signature_util_js_1 = require("../email-signature/email-signature.util.js");
const signature_image_storage_js_1 = require("./signature-image.storage.js");
const signature_image_util_js_1 = require("./signature-image.util.js");
let SignatureImageService = SignatureImageService_1 = class SignatureImageService {
    prisma;
    logger = new common_1.Logger(SignatureImageService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(scope = null) {
        const rows = await this.prisma.signatureImage.findMany({
            where: { deletedAt: null, ...(0, signature_image_util_js_1.imageScopeWhere)(scope) },
            orderBy: [{ companyId: 'desc' }, { createdAt: 'desc' }],
        });
        return rows.map((row) => this.toView(row));
    }
    async create(file, name, uploadedById, scope = null) {
        if (scope !== null)
            await this.assertScopeCompany(scope);
        let png;
        let width;
        let height;
        try {
            const source = (0, sharp_1.default)(file.buffer, { failOn: 'none' });
            const meta = await source.metadata();
            const bounded = (0, signature_image_util_js_1.boundedSize)({
                width: meta.width ?? 0,
                height: meta.height ?? 0,
            });
            png = await source
                .resize(bounded.width, bounded.height, { fit: 'inside' })
                .png({ compressionLevel: 9 })
                .toBuffer();
            const out = await (0, sharp_1.default)(png).metadata();
            width = out.width ?? bounded.width;
            height = out.height ?? bounded.height;
        }
        catch (err) {
            this.logger.warn(`signature image decode failed: ${String(err)}`);
            throw new common_1.BadRequestException('That file could not be read as an image. Try a PNG or JPEG.');
        }
        if (scope !== null) {
            const existing = await this.prisma.signatureImage.count({
                where: { companyId: scope, deletedAt: null },
            });
            if (existing >= signature_image_util_js_1.MAX_COMPANY_LOGOS) {
                throw new common_1.BadRequestException(`This company already has ${signature_image_util_js_1.MAX_COMPANY_LOGOS} logos. Remove one first.`);
            }
        }
        const storagePath = (0, signature_image_storage_js_1.newImageStoragePath)();
        (0, signature_image_storage_js_1.ensureSignatureImageDir)();
        await (0, promises_1.writeFile)((0, uploads_js_1.resolveStoredPath)(storagePath), png);
        const row = await this.prisma.signatureImage.create({
            data: {
                name: (name ?? '').trim() || (0, signature_image_util_js_1.defaultImageName)(file.originalname),
                publicId: (0, crypto_1.randomUUID)(),
                filename: file.originalname,
                mimeType: 'image/png',
                size: png.length,
                width,
                height,
                storagePath,
                uploadedById,
                companyId: scope,
            },
        });
        return this.toView(row);
    }
    async rename(id, name, scope = null) {
        await this.getInLibraryOrThrow(id, scope);
        const trimmed = name.trim();
        if (!trimmed)
            throw new common_1.BadRequestException('A name is required');
        const row = await this.prisma.signatureImage.update({
            where: { id },
            data: { name: trimmed.slice(0, 80) },
        });
        return this.toView(row);
    }
    async remove(id, scope = null) {
        await this.getInLibraryOrThrow(id, scope);
        await this.prisma.signatureImage.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    async urlFor(settingValue, scope) {
        const id = (0, email_signature_util_js_1.imageIdOrNone)(settingValue);
        if (id === null)
            return null;
        try {
            const row = await this.prisma.signatureImage.findFirst({
                where: {
                    id,
                    deletedAt: null,
                    ...(scope !== undefined ? (0, signature_image_util_js_1.imageScopeWhere)(scope) : {}),
                },
                select: { publicId: true },
            });
            if (!row) {
                this.logger.warn(`email signature names image ${id}, which is missing or deleted — rendering without a logo`);
                return null;
            }
            return (0, public_base_js_1.signatureImageUrl)(process.env, row.publicId);
        }
        catch (err) {
            this.logger.warn(`signature image lookup failed: ${String(err)}`);
            return null;
        }
    }
    async streamableByPublicId(publicId) {
        const row = await this.prisma.signatureImage.findFirst({
            where: { publicId, deletedAt: null },
        });
        if (!row)
            throw new common_1.NotFoundException('Image not found');
        return {
            absolutePath: (0, uploads_js_1.resolveStoredPath)(row.storagePath),
            mimeType: row.mimeType,
            filename: `${row.name}.png`,
        };
    }
    async assertUsableBy(settingValue, scope) {
        const id = (0, email_signature_util_js_1.imageIdOrNone)(typeof settingValue === 'number' ? settingValue : null);
        if (id === null)
            return;
        const row = await this.prisma.signatureImage.findFirst({
            where: { id, deletedAt: null },
            select: { companyId: true },
        });
        if (!row)
            throw new common_1.BadRequestException('That logo no longer exists');
        if (!(0, signature_image_util_js_1.isImageVisibleTo)(row.companyId, scope)) {
            throw new common_1.BadRequestException(scope === null
                ? 'That logo belongs to one company and cannot be the firm-wide default'
                : 'That logo belongs to another company');
        }
    }
    assertScopeCompany(companyId) {
        return (0, company_target_util_js_1.assertRealCompany)(this.prisma, companyId, 'Internal workspaces send no email and have no signature logos');
    }
    async getInLibraryOrThrow(id, scope) {
        const row = await this.getOrThrow(id);
        if (!(0, signature_image_util_js_1.isImageInLibrary)(row.companyId, scope)) {
            throw new common_1.NotFoundException('Image not found');
        }
        return row;
    }
    async getOrThrow(id) {
        const row = await this.prisma.signatureImage.findFirst({
            where: { id, deletedAt: null },
        });
        if (!row)
            throw new common_1.NotFoundException('Image not found');
        return row;
    }
    toView(row) {
        return {
            id: row.id,
            name: row.name,
            filename: row.filename,
            size: row.size,
            width: row.width,
            height: row.height,
            createdAt: row.createdAt.toISOString(),
            url: (0, public_base_js_1.signatureImageUrl)(process.env, row.publicId),
            companyId: row.companyId,
        };
    }
};
exports.SignatureImageService = SignatureImageService;
exports.SignatureImageService = SignatureImageService = SignatureImageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], SignatureImageService);
//# sourceMappingURL=signature-image.service.js.map