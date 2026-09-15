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
            query: { fields: 'id,display_phone_number,verified_name,status' },
            timeoutMs: TIMEOUTS.read,
        });
        return {
            id: data?.id ?? phoneNumberId,
            displayPhoneNumber: data?.display_phone_number ?? phoneNumberId,
            verifiedName: data?.verified_name ?? null,
            status: data?.status ?? null,
        };
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
    async sendText(phoneNumberId, token, to, body) {
        return this.sendMessage(`sendText ${phoneNumberId}`, phoneNumberId, token, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body },
        });
    }
    async sendAudio(phoneNumberId, token, to, mediaId) {
        return this.sendMessage(`sendAudio ${phoneNumberId}`, phoneNumberId, token, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'audio',
            audio: { id: mediaId },
        });
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