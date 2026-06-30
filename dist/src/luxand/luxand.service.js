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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LuxandService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const sharp_1 = __importDefault(require("sharp"));
let LuxandService = class LuxandService {
    baseUrl = 'https://api.luxand.cloud';
    apiKey;
    minConfidence;
    constructor(config) {
        this.apiKey = config.getOrThrow('LUXAND_API_KEY');
        this.minConfidence = parseFloat(config.get('LUXAND_MIN_CONFIDENCE') ?? '0.85');
    }
    async preprocessImage(buffer) {
        return (0, sharp_1.default)(buffer).normalize().jpeg({ quality: 92 }).toBuffer();
    }
    async enrollPerson(name, photo, mimeType) {
        const normalized = await this.preprocessImage(photo);
        const form = new FormData();
        form.append('photo', new Blob([new Uint8Array(normalized)], { type: 'image/jpeg' }), 'photo.jpg');
        form.append('name', name);
        const res = await fetch(`${this.baseUrl}/subject/v2`, {
            method: 'POST',
            headers: { token: this.apiKey },
            body: form,
        });
        if (!res.ok) {
            const body = await res.text();
            throw new common_1.BadGatewayException(`Luxand enroll failed (${res.status}): ${body}`);
        }
        const data = (await res.json());
        if (!data.id) {
            throw new common_1.BadGatewayException(`Luxand enroll response missing id: ${JSON.stringify(data)}`);
        }
        return String(data.id);
    }
    async searchFace(photo, mimeType, options) {
        const normalized = await this.preprocessImage(photo);
        const form = new FormData();
        form.append('photo', new Blob([new Uint8Array(normalized)], { type: 'image/jpeg' }), 'photo.jpg');
        const res = await fetch(`${this.baseUrl}/photo/search`, {
            method: 'POST',
            headers: { token: this.apiKey },
            body: form,
        });
        if (!res.ok) {
            const body = await res.text();
            throw new common_1.BadGatewayException(`Luxand search failed (${res.status}): ${body}`);
        }
        const data = (await res.json());
        let id;
        let score;
        if (Array.isArray(data)) {
            if (data.length === 0)
                return null;
            const top = data[0];
            id = top.uuid
                ? String(top.uuid)
                : top.id != null
                    ? String(top.id)
                    : undefined;
            score = top.probability ?? top.confidence;
        }
        else {
            if (data.status !== 'success')
                return null;
            id = data.id != null ? String(data.id) : undefined;
            score = data.confidence ?? data.probability;
        }
        if (!id || score === undefined)
            return null;
        const threshold = options?.minConfidence ?? this.minConfidence;
        if (score < threshold)
            return null;
        return { uuid: id, probability: score };
    }
    async deletePerson(id) {
        await fetch(`${this.baseUrl}/subject/v2/${id}`, {
            method: 'DELETE',
            headers: { token: this.apiKey },
        });
    }
};
exports.LuxandService = LuxandService;
exports.LuxandService = LuxandService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], LuxandService);
//# sourceMappingURL=luxand.service.js.map