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
    listCalls: 15_000,
    listMessages: 15_000,
    listRecordings: 12_000,
    fetchRecording: 30_000,
    sendSms: 15_000,
    createCall: 15_000,
    updateRecording: 10_000,
};
const DEFAULT_PAGE_SIZE = 200;
function isoOrUndefined(ms) {
    return ms === undefined ? undefined : new Date(ms).toISOString();
}
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
    async listCalls(opts) {
        const data = await this.call(`listCalls${opts.to ? ' to=' + opts.to : ''}${opts.from ? ' from=' + opts.from : ''}`, '/Calls', {
            method: 'GET',
            query: {
                To: opts.to,
                From: opts.from,
                'StartTime>': isoOrUndefined(opts.after),
                'StartTime<': isoOrUndefined(opts.before),
                PageSize: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
            },
            timeoutMs: TIMEOUTS.listCalls,
        });
        return (0, signalwire_parse_js_1.parseCalls)(data);
    }
    async listMessages(opts) {
        const data = await this.call(`listMessages${opts.to ? ' to=' + opts.to : ''}${opts.from ? ' from=' + opts.from : ''}`, '/Messages', {
            method: 'GET',
            query: {
                To: opts.to,
                From: opts.from,
                'DateSent>': isoOrUndefined(opts.after),
                'DateSent<': isoOrUndefined(opts.before),
                PageSize: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
            },
            timeoutMs: TIMEOUTS.listMessages,
        });
        return (0, signalwire_parse_js_1.parseMessages)(data);
    }
    async getCall(sid) {
        let data;
        try {
            data = await this.call(`getCall ${sid}`, `/Calls/${encodeURIComponent(sid)}`, { method: 'GET', timeoutMs: TIMEOUTS.listCalls });
        }
        catch {
            return null;
        }
        const [call] = (0, signalwire_parse_js_1.parseCalls)({ calls: [data] });
        return call ?? null;
    }
    async listRecordings(opts = {}) {
        const data = await this.call(`listRecordings${opts.callSid ? ' call=' + opts.callSid : ' (account)'}`, '/Recordings', {
            method: 'GET',
            query: {
                CallSid: opts.callSid,
                PageSize: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
            },
            timeoutMs: TIMEOUTS.listRecordings,
        });
        return (0, signalwire_parse_js_1.parseRecordings)(data);
    }
    async updateRecording(callSid, recordingSid, status) {
        try {
            await this.call(`updateRecording ${recordingSid} ${status}`, `/Calls/${encodeURIComponent(callSid)}/Recordings/${encodeURIComponent(recordingSid)}`, {
                method: 'POST',
                form: {
                    Status: status,
                    PauseBehavior: status === 'paused' ? 'skip' : undefined,
                },
                timeoutMs: TIMEOUTS.updateRecording,
            });
            return true;
        }
        catch (err) {
            this.logger.warn(`updateRecording ${recordingSid} -> ${status} failed: ${String(err)}`);
            return false;
        }
    }
    async fetchRecordingMedia(sid) {
        const url = `${this.baseUrl}/Recordings/${encodeURIComponent(sid)}.mp3`;
        const started = Date.now();
        let res;
        try {
            res = await fetch(url, {
                headers: { Authorization: this.authHeader },
                signal: AbortSignal.timeout(this.timeoutOverride ?? TIMEOUTS.fetchRecording),
            });
        }
        catch (err) {
            const name = err instanceof Error ? err.name : 'Error';
            this.logger.error(`fetchRecordingMedia ${sid} FAILED ${name} ${Date.now() - started}ms`);
            throw new common_1.BadGatewayException('Recording could not be fetched');
        }
        if (!res.ok) {
            this.logger.warn(`fetchRecordingMedia ${sid} ${res.status} ${Date.now() - started}ms`);
            throw new common_1.NotFoundException('Recording not found');
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        this.logger.log(`fetchRecordingMedia ${sid} ${res.status} ${Date.now() - started}ms ${buffer.length}B`);
        return {
            buffer,
            contentType: res.headers.get('content-type') ?? 'audio/mpeg',
        };
    }
    async sendSms(input) {
        const data = await this.call(`sendSms to=${input.to}`, '/Messages', {
            method: 'POST',
            form: { To: input.to, From: input.from, Body: input.body },
            timeoutMs: TIMEOUTS.sendSms,
        });
        const [message] = (0, signalwire_parse_js_1.parseMessages)({ messages: [data] });
        if (!message) {
            this.logger.error(`sendSms to ${input.to} returned an unreadable body — the message may have been sent`);
            throw new common_1.BadGatewayException('Phone service returned an unreadable send response');
        }
        return message;
    }
    async createCall(input) {
        const data = await this.call(`createCall to=${input.to}`, '/Calls', {
            method: 'POST',
            form: {
                To: input.to,
                From: input.from,
                Laml: input.laml,
                StatusCallback: input.statusCallback,
                StatusCallbackMethod: input.statusCallback ? 'POST' : undefined,
                Timeout: String(input.timeoutSec ?? 30),
            },
            timeoutMs: TIMEOUTS.createCall,
        });
        const [created] = (0, signalwire_parse_js_1.parseCalls)({ calls: [data] });
        if (!created) {
            this.logger.error(`createCall to ${input.to} returned an unreadable body — a call may be in progress`);
            throw new common_1.BadGatewayException('Phone service returned an unreadable call response');
        }
        return created;
    }
};
exports.SignalWireService = SignalWireService;
exports.SignalWireService = SignalWireService = SignalWireService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SignalWireService);
//# sourceMappingURL=signalwire.service.js.map