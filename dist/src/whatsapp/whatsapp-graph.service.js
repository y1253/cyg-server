"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var WhatsAppGraphService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppGraphService = exports.WhatsAppGraphError = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
const whatsapp_util_js_1 = require("./whatsapp.util.js");
const TIMEOUTS = {
    exchangeCode: 10_000,
    read: 10_000,
    subscribe: 15_000,
    register: 20_000,
    send: 15_000,
    uploadMedia: 60_000,
    downloadMedia: 60_000,
};
const PHONE_NUMBER_FIELDS = 'id,display_phone_number,verified_name,status,code_verification_status';
function toPhoneNumber(data, id) {
    return {
        id: data?.id ?? id,
        displayPhoneNumber: data?.display_phone_number ?? id,
        verifiedName: data?.verified_name ?? null,
        status: data?.status ?? null,
        codeVerificationStatus: data?.code_verification_status ?? null,
    };
}
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
class WhatsAppGraphError extends Error {
    httpStatus;
    code;
    subcode;
    constructor(message, httpStatus, code = null, subcode = null) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.subcode = subcode;
        this.name = 'WhatsAppGraphError';
    }
}
exports.WhatsAppGraphError = WhatsAppGraphError;
let WhatsAppGraphService = WhatsAppGraphService_1 = class WhatsAppGraphService {
    logger = new common_1.Logger(WhatsAppGraphService_1.name);
    get base() {
        return `https://graph.facebook.com/${(0, whatsapp_util_js_1.whatsappConfig)(process.env).graphVersion}`;
    }
    async call(label, path, init) {
        const url = new URL(`${this.base}${path}`);
        for (const [key, value] of Object.entries(init.query ?? {})) {
            if (value !== undefined)
                url.searchParams.set(key, value);
        }
        const headers = {};
        if (init.token)
            headers.Authorization = `Bearer ${init.token}`;
        if (init.json !== undefined)
            headers['Content-Type'] = 'application/json';
        const started = Date.now();
        let res;
        try {
            res = await fetch(url, {
                method: init.method,
                headers,
                body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
                signal: AbortSignal.timeout(init.timeoutMs),
            });
        }
        catch (err) {
            const name = err instanceof Error ? err.name : 'Error';
            this.logger.warn(`${label} ${name} after ${Date.now() - started}ms`);
            throw new WhatsAppGraphError(name === 'TimeoutError'
                ? 'WhatsApp did not respond in time'
                : 'WhatsApp could not be reached', 0);
        }
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = null;
        }
        this.logger.log(`${label} ${res.status} ${Date.now() - started}ms`);
        const error = (0, whatsapp_util_js_1.graphErrorOf)(data);
        if (!res.ok || error) {
            this.logger.warn(`${label} failed: ${error?.message ?? res.statusText} code=${error?.code ?? '-'} subcode=${error?.subcode ?? '-'}`);
            throw new WhatsAppGraphError(error?.message ?? `WhatsApp request failed (${res.status})`, res.status, error?.code ?? null, error?.subcode ?? null);
        }
        return data;
    }
    async exchangeCode(code) {
        const cfg = (0, whatsapp_util_js_1.whatsappConfig)(process.env);
        if (!cfg.appId || !cfg.appSecret) {
            throw new WhatsAppGraphError('WhatsApp is not configured on the server (WHATSAPP_ID / WHATSAPP_SECRET)', 0);
        }
        const data = await this.call('exchangeCode', '/oauth/access_token', {
            method: 'GET',
            query: { client_id: cfg.appId, client_secret: cfg.appSecret, code },
            timeoutMs: TIMEOUTS.exchangeCode,
        });
        if (!data?.access_token) {
            throw new WhatsAppGraphError('Meta returned no access token', 200);
        }
        return data.access_token;
    }
    async getPhoneNumber(phoneNumberId, token) {
        const data = await this.call(`getPhoneNumber ${phoneNumberId}`, `/${phoneNumberId}`, {
            method: 'GET',
            token,
            query: { fields: PHONE_NUMBER_FIELDS },
            timeoutMs: TIMEOUTS.read,
        });
        return toPhoneNumber(data, phoneNumberId);
    }
    async addPhoneNumber(wabaId, cc, phoneNumber, verifiedName, token) {
        const data = await this.call(`addPhoneNumber ${wabaId}`, `/${wabaId}/phone_numbers`, {
            method: 'POST',
            token,
            json: { cc, phone_number: phoneNumber, verified_name: verifiedName },
            timeoutMs: TIMEOUTS.register,
        });
        if (!data?.id) {
            throw new WhatsAppGraphError('WhatsApp added the number but returned no id', 200);
        }
        return data.id;
    }
    async findWabaPhoneNumber(wabaId, digits, token) {
        const data = await this.call(`findPhoneNumber ${wabaId}`, `/${wabaId}/phone_numbers`, {
            method: 'GET',
            token,
            query: { fields: PHONE_NUMBER_FIELDS, limit: '100' },
            timeoutMs: TIMEOUTS.read,
        });
        const hit = (data?.data ?? []).find((row) => (row.display_phone_number ?? '').replace(/\D/g, '') === digits);
        return hit?.id ? toPhoneNumber(hit, hit.id) : null;
    }
    async requestCode(phoneNumberId, token, codeMethod = 'SMS') {
        await this.call(`requestCode ${codeMethod} ${phoneNumberId}`, `/${phoneNumberId}/request_code`, {
            method: 'POST',
            token,
            query: { code_method: codeMethod, language: 'en_US' },
            timeoutMs: TIMEOUTS.register,
        });
    }
    async verifyCode(phoneNumberId, code, token) {
        await this.call(`verifyCode ${phoneNumberId}`, `/${phoneNumberId}/verify_code`, {
            method: 'POST',
            token,
            query: { code },
            timeoutMs: TIMEOUTS.register,
        });
    }
    async deregisterNumber(phoneNumberId, token) {
        await this.call(`deregisterNumber ${phoneNumberId}`, `/${phoneNumberId}/deregister`, { method: 'POST', token, timeoutMs: TIMEOUTS.register });
    }
    async listWabaPhoneNumberIds(wabaId, token) {
        const data = await this.call(`listPhoneNumbers ${wabaId}`, `/${wabaId}/phone_numbers`, {
            method: 'GET',
            token,
            query: { fields: 'id', limit: '100' },
            timeoutMs: TIMEOUTS.read,
        });
        return (data?.data ?? [])
            .map((row) => row.id)
            .filter((id) => typeof id === 'string');
    }
    async subscribeApp(wabaId, token) {
        await this.call(`subscribeApp ${wabaId}`, `/${wabaId}/subscribed_apps`, {
            method: 'POST',
            token,
            timeoutMs: TIMEOUTS.subscribe,
        });
    }
    async unsubscribeApp(wabaId, token) {
        await this.call(`unsubscribeApp ${wabaId}`, `/${wabaId}/subscribed_apps`, {
            method: 'DELETE',
            token,
            timeoutMs: TIMEOUTS.subscribe,
        });
    }
    async registerNumber(phoneNumberId, pin, token) {
        await this.call(`registerNumber ${phoneNumberId}`, `/${phoneNumberId}/register`, {
            method: 'POST',
            token,
            json: { messaging_product: 'whatsapp', pin },
            timeoutMs: TIMEOUTS.register,
        });
    }
    async sendText(phoneNumberId, token, to, body, replyToWamid) {
        return this.sendMessage(`sendText ${phoneNumberId}`, phoneNumberId, token, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body },
            ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
        });
    }
    async listTemplates(wabaId, token) {
        const data = await this.call(`listTemplates ${wabaId}`, `/${wabaId}/message_templates`, {
            method: 'GET',
            token,
            query: {
                fields: 'name,language,status,category,components',
                limit: '200',
            },
            timeoutMs: TIMEOUTS.send,
        });
        return (data?.data ?? [])
            .filter((t) => t.status === 'APPROVED')
            .map(whatsapp_util_js_1.toTemplate)
            .filter((t) => t !== null);
    }
    async sendTemplate(phoneNumberId, token, to, name, language, components) {
        return this.sendMessage(`sendTemplate ${phoneNumberId}`, phoneNumberId, token, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
                name,
                language: { code: language },
                ...(components.length ? { components } : {}),
            },
        });
    }
    async sendMedia(phoneNumberId, token, to, kind, mediaId, opts = {}) {
        const media = { id: mediaId };
        if (opts.caption && (0, whatsapp_util_js_1.whatsappAcceptsCaption)(kind)) {
            media.caption = opts.caption;
        }
        if (opts.filename && kind === 'document')
            media.filename = opts.filename;
        return this.sendMessage(`sendMedia ${kind} ${phoneNumberId}`, phoneNumberId, token, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: kind,
            [kind]: media,
            ...(opts.replyToWamid
                ? { context: { message_id: opts.replyToWamid } }
                : {}),
        });
    }
    async sendAudio(phoneNumberId, token, to, mediaId) {
        return this.sendMedia(phoneNumberId, token, to, 'audio', mediaId);
    }
    async sendMessage(label, phoneNumberId, token, payload) {
        const data = await this.call(label, `/${phoneNumberId}/messages`, { method: 'POST', token, json: payload, timeoutMs: TIMEOUTS.send });
        const wamid = data?.messages?.[0]?.id;
        if (!wamid) {
            throw new WhatsAppGraphError('WhatsApp accepted the message but returned no id', 200);
        }
        return wamid;
    }
    async uploadMedia(phoneNumberId, token, bytes, mimeType, filename) {
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', mimeType);
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        form.append('file', new Blob([copy], { type: mimeType }), filename);
        const data = await this.call(`uploadMedia ${phoneNumberId}`, `/${phoneNumberId}/media`, { method: 'POST', token, form, timeoutMs: TIMEOUTS.uploadMedia });
        if (!data?.id) {
            throw new WhatsAppGraphError('WhatsApp stored the file but returned no id', 200);
        }
        return data.id;
    }
    async uploadMediaFromFile(phoneNumberId, token, absolutePath, mimeType, filename) {
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', mimeType);
        form.append('file', await (0, fs_1.openAsBlob)(absolutePath, { type: mimeType }), filename);
        const data = await this.call(`uploadMediaFromFile ${phoneNumberId}`, `/${phoneNumberId}/media`, { method: 'POST', token, form, timeoutMs: TIMEOUTS.uploadMedia });
        if (!data?.id) {
            throw new WhatsAppGraphError('WhatsApp stored the file but returned no id', 200);
        }
        return data.id;
    }
    async downloadMedia(mediaId, token) {
        const info = await this.call(`getMedia ${mediaId}`, `/${mediaId}`, {
            method: 'GET',
            token,
            timeoutMs: TIMEOUTS.read,
        });
        if (!info?.url)
            throw new WhatsAppGraphError('WhatsApp returned no media URL', 200);
        if (typeof info.file_size === 'number' &&
            info.file_size > MAX_MEDIA_BYTES) {
            throw new WhatsAppGraphError('WhatsApp media is too large to store', 413);
        }
        const started = Date.now();
        const res = await fetch(info.url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(TIMEOUTS.downloadMedia),
        });
        this.logger.log(`downloadMedia ${mediaId} ${res.status} ${Date.now() - started}ms`);
        if (!res.ok) {
            throw new WhatsAppGraphError(`WhatsApp media download failed (${res.status})`, res.status);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > MAX_MEDIA_BYTES) {
            throw new WhatsAppGraphError('WhatsApp media is too large to store', 413);
        }
        return {
            bytes,
            mimeType: info.mime_type ?? res.headers.get('content-type'),
        };
    }
};
exports.WhatsAppGraphService = WhatsAppGraphService;
exports.WhatsAppGraphService = WhatsAppGraphService = WhatsAppGraphService_1 = __decorate([
    (0, common_1.Injectable)()
], WhatsAppGraphService);
//# sourceMappingURL=whatsapp-graph.service.js.map