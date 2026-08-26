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
var SignalWireService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalWireService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const signalwire_parse_js_1 = require("./signalwire-parse.js");
const TIMEOUTS = {
    searchAvailable: 12_000,
    purchaseNumber: 20_000,
    releaseNumber: 10_000,
    listOwned: 12_000,
};
let SignalWireService = SignalWireService_1 = class SignalWireService {
    logger = new common_1.Logger(SignalWireService_1.name);
    baseUrl;
    authHeader;
    timeoutOverride;
    constructor(config) {
        const space = config
            .getOrThrow('SIGNALWIRE_SPACE_URL')
            .replace(/^https?:\/\//, '')
            .replace(/\/+$/, '');
        const projectId = config.getOrThrow('SIGNALWIRE_PROJECT_ID');
        const apiToken = config.getOrThrow('SIGNALWIRE_API_TOKEN');
        this.baseUrl = `https://${space}/api/laml/2010-04-01/Accounts/${projectId}`;
        this.authHeader =
            'Basic ' + Buffer.from(`${projectId}:${apiToken}`).toString('base64');
        const timeout = config.get('SIGNALWIRE_TIMEOUT_MS');
        this.timeoutOverride = timeout ? parseInt(timeout, 10) : null;
    }
    async call(label, path, init) {
        const url = new URL(this.baseUrl + path);
        for (const [key, value] of Object.entries(init.query ?? {})) {
            if (value !== undefined && value !== '')
                url.searchParams.set(key, value);
        }
        let body;
        if (init.form) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(init.form)) {
                if (value !== undefined && value !== '')
                    params.set(key, value);
            }
            body = params.toString();
        }
        const started = Date.now();
        let res;
        try {
            res = await fetch(url, {
                method: init.method,
                headers: {
                    Authorization: this.authHeader,
                    Accept: 'application/json',
                    ...(body
                        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
                        : {}),
                },
                ...(body ? { body } : {}),
                signal: AbortSignal.timeout(this.timeoutOverride ?? init.timeoutMs),
            });
        }
        catch (err) {
            const name = err instanceof Error ? err.name : 'Error';
            this.logger.error(`${label} FAILED ${name} ${Date.now() - started}ms`);
            if (name === 'TimeoutError' || name === 'AbortError') {
                throw new common_1.BadGatewayException('Phone service timed out');
            }
            throw new common_1.BadGatewayException('Phone service unreachable');
        }
        const raw = await res.text();
        this.logger.log(`${label} ${res.status} ${Date.now() - started}ms`);
        if (res.status === 204 || raw === '') {
            if (!res.ok) {
                throw new common_1.BadGatewayException(`Phone service error (${res.status}): empty response body`);
            }
            return null;
        }
        let data = null;
        try {
            data = JSON.parse(raw);
        }
        catch {
        }
        if (!res.ok) {
            const message = (0, signalwire_parse_js_1.signalwireErrorMessage)(data, raw);
            this.logger.warn(`${label} rejected: ${message.slice(0, 300)}`);
            throw new common_1.BadGatewayException(`Phone service error: ${message}`);
        }
        return data;
    }
    async searchAvailable(country, opts = {}) {
        const data = await this.call(`searchAvailable ${country}${opts.inRegion ? '/' + opts.inRegion : ''}${opts.areaCode ? '/' + opts.areaCode : ''}`, `/AvailablePhoneNumbers/${country}/Local`, {
            method: 'GET',
            query: {
                AreaCode: opts.areaCode,
                InRegion: opts.inRegion,
                InLocality: opts.inLocality,
            },
            timeoutMs: TIMEOUTS.searchAvailable,
        });
        return (0, signalwire_parse_js_1.parseAvailableNumbers)(data);
    }
    async purchaseNumber(input) {
        const data = await this.call(`purchaseNumber ${input.phoneNumber}`, '/IncomingPhoneNumbers', {
            method: 'POST',
            form: {
                PhoneNumber: input.phoneNumber,
                FriendlyName: input.friendlyName,
                VoiceUrl: input.voiceUrl,
                VoiceMethod: input.voiceUrl ? 'POST' : undefined,
                SmsUrl: input.smsUrl,
                SmsMethod: input.smsUrl ? 'POST' : undefined,
                StatusCallback: input.statusCallback,
            },
            timeoutMs: TIMEOUTS.purchaseNumber,
        });
        const purchased = (0, signalwire_parse_js_1.parsePurchasedNumber)(data);
        if (!purchased) {
            this.logger.error(`PHONE ORPHAN RISK — purchase of ${input.phoneNumber} returned an unreadable body; ` +
                `check the SignalWire dashboard for a number with no matching SupportNumber row`);
            throw new common_1.BadGatewayException('Phone service returned an unreadable purchase response');
        }
        this.logger.log(`purchaseNumber ${purchased.phoneNumber} sid=${purchased.sid} ` +
            `capabilities=${purchased.capabilitiesRaw ?? 'ABSENT'}`);
        return purchased;
    }
    async releaseNumber(sid) {
        try {
            await this.call(`releaseNumber ${sid}`, `/IncomingPhoneNumbers/${sid}`, {
                method: 'DELETE',
                timeoutMs: TIMEOUTS.releaseNumber,
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/\b404\b|not found/i.test(message)) {
                this.logger.warn(`releaseNumber ${sid} already absent — treating as released`);
                return;
            }
            throw err;
        }
    }
    async listOwned(pageSize = 50) {
        const data = await this.call('listOwned', '/IncomingPhoneNumbers', {
            method: 'GET',
            query: { PageSize: String(pageSize) },
            timeoutMs: TIMEOUTS.listOwned,
        });
        return (0, signalwire_parse_js_1.parseOwnedNumbers)(data);
    }
};
exports.SignalWireService = SignalWireService;
exports.SignalWireService = SignalWireService = SignalWireService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SignalWireService);
//# sourceMappingURL=signalwire.service.js.map