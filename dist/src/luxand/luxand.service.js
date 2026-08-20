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
var LuxandService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LuxandService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const luxand_parse_js_1 = require("./luxand-parse.js");
const TIMEOUTS = {
    createPerson: 20_000,
    addPhoto: 10_000,
    verify: 8_000,
    liveness: 8_000,
    search: 12_000,
    deletePerson: 5_000,
};
let LuxandService = LuxandService_1 = class LuxandService {
    logger = new common_1.Logger(LuxandService_1.name);
    baseUrl = 'https://api.luxand.cloud';
    apiKey;
    searchMinConfidence;
    verifyMinConfidence;
    livenessMin;
    timeoutOverride;
    constructor(config) {
        this.apiKey = config.getOrThrow('LUXAND_API_KEY');
        this.searchMinConfidence = parseFloat(config.get('LUXAND_MIN_CONFIDENCE') ?? '0.75');
        this.verifyMinConfidence = parseFloat(config.get('LUXAND_VERIFY_MIN_CONFIDENCE') ?? '0.75');
        this.livenessMin = parseFloat(config.get('LUXAND_LIVENESS_MIN') ?? '0.5');
        const timeout = config.get('LUXAND_TIMEOUT_MS');
        this.timeoutOverride = timeout ? parseInt(timeout, 10) : null;
    }
    async call(label, path, init) {
        const started = Date.now();
        let res;
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method: init.method,
                headers: { token: this.apiKey },
                ...(init.form ? { body: init.form } : {}),
                signal: AbortSignal.timeout(this.timeoutOverride ?? init.timeoutMs),
            });
        }
        catch (err) {
            const name = err instanceof Error ? err.name : 'Error';
            this.logger.error(`${label} FAILED ${name} ${Date.now() - started}ms`);
            if (name === 'TimeoutError' || name === 'AbortError') {
                throw new common_1.BadGatewayException('Face service timed out');
            }
            throw new common_1.BadGatewayException('Face service unreachable');
        }
        const raw = await res.text();
        this.logger.log(`${label} ${res.status} ${Date.now() - started}ms`);
        let data = null;
        try {
            data = JSON.parse(raw);
        }
        catch {
        }
        if (!res.ok || (0, luxand_parse_js_1.isFailureEnvelope)(data)) {
            const message = (0, luxand_parse_js_1.failureMessage)(data, raw);
            this.logger.warn(`${label} rejected: ${message.slice(0, 300)}`);
            throw new common_1.BadGatewayException((0, luxand_parse_js_1.describeLuxandError)(message));
        }
        return data;
    }
    appendPhoto(form, field, photo) {
        form.append(field, new Blob([new Uint8Array(photo.buffer)], {
            type: photo.mimeType ?? 'image/jpeg',
        }), 'photo.jpg');
    }
    async createPerson(name, photos) {
        const form = new FormData();
        form.append('name', name);
        form.append('store', '1');
        for (const photo of photos) {
            this.appendPhoto(form, 'photos', photo);
        }
        const data = await this.call('createPerson', '/v2/person', {
            method: 'POST',
            form,
            timeoutMs: TIMEOUTS.createPerson,
        });
        const id = (0, luxand_parse_js_1.extractId)(data);
        if (!id) {
            throw new common_1.BadGatewayException(`Luxand create response missing person id: ${JSON.stringify(data).slice(0, 300)}`);
        }
        return id;
    }
    async addPhoto(uuid, photo) {
        const form = new FormData();
        this.appendPhoto(form, 'photo', photo);
        form.append('store', '1');
        await this.call('addPhoto', `/v2/person/${uuid}`, {
            method: 'POST',
            form,
            timeoutMs: TIMEOUTS.addPhoto,
        });
    }
    async verify(uuid, photo) {
        const form = new FormData();
        this.appendPhoto(form, 'photo', photo);
        const data = await this.call('verify', `/photo/verify/${uuid}`, {
            method: 'POST',
            form,
            timeoutMs: TIMEOUTS.verify,
        });
        const raw = (0, luxand_parse_js_1.extractScore)(data);
        if (raw === null) {
            throw new common_1.BadGatewayException(`Luxand verify: unrecognised response ${JSON.stringify(data).slice(0, 300)}`);
        }
        const probability = (0, luxand_parse_js_1.normalizeScore)(raw);
        return { matched: probability >= this.verifyMinConfidence, probability };
    }
    async liveness(photo) {
        const form = new FormData();
        this.appendPhoto(form, 'photo', photo);
        const data = await this.call('liveness', '/photo/liveness/v2', {
            method: 'POST',
            form,
            timeoutMs: TIMEOUTS.liveness,
        });
        const raw = (0, luxand_parse_js_1.extractScore)(data);
        if (raw === null) {
            this.logger.warn(`liveness: unrecognised response, treating as live: ${JSON.stringify(data).slice(0, 200)}`);
            return { live: true, score: null };
        }
        const score = (0, luxand_parse_js_1.normalizeScore)(raw);
        return { live: score >= this.livenessMin, score };
    }
    async search(photo) {
        const form = new FormData();
        this.appendPhoto(form, 'photo', photo);
        const data = await this.call('search', '/photo/search/v2', {
            method: 'POST',
            form,
            timeoutMs: TIMEOUTS.search,
        });
        if (Array.isArray(data) && data.length === 0)
            return null;
        const uuid = (0, luxand_parse_js_1.extractId)(data);
        const raw = (0, luxand_parse_js_1.extractScore)(data);
        if (!uuid || raw === null)
            return null;
        const probability = (0, luxand_parse_js_1.normalizeScore)(raw);
        return probability < this.searchMinConfidence
            ? null
            : { uuid, probability };
    }
    async deletePerson(id) {
        try {
            await this.call('deletePerson', `/v2/person/${id}`, {
                method: 'DELETE',
                timeoutMs: TIMEOUTS.deletePerson,
            });
            return;
        }
        catch {
        }
        await this.call('deleteSubject', `/subject/${id}`, {
            method: 'DELETE',
            timeoutMs: TIMEOUTS.deletePerson,
        });
    }
};
exports.LuxandService = LuxandService;
exports.LuxandService = LuxandService = LuxandService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], LuxandService);
//# sourceMappingURL=luxand.service.js.map