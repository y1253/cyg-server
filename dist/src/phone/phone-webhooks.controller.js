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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var PhoneWebhooksController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneWebhooksController = void 0;
const common_1 = require("@nestjs/common");
const laml_util_js_1 = require("./laml.util.js");
const call_routing_service_js_1 = require("./call-routing.service.js");
const phone_events_service_js_1 = require("./phone-events.service.js");
const signature_util_js_1 = require("./signature.util.js");
const phone_config_js_1 = require("./phone.config.js");
const phone_timeline_service_js_1 = require("./phone-timeline.service.js");
const phone_settings_service_js_1 = require("../phone-settings/phone-settings.service.js");
const call_summary_service_js_1 = require("./call-summary.service.js");
const phone_hours_util_js_1 = require("../phone-settings/phone-hours.util.js");
const phone_message_util_js_1 = require("../phone-settings/phone-message.util.js");
const TERMINAL_CALL_STATUSES = new Set([
    'completed',
    'canceled',
    'no-answer',
    'busy',
    'failed',
]);
let PhoneWebhooksController = PhoneWebhooksController_1 = class PhoneWebhooksController {
    routing;
    events;
    timeline;
    settings;
    summaries;
    logger = new common_1.Logger(PhoneWebhooksController_1.name);
    constructor(routing, events, timeline, settings, summaries) {
        this.routing = routing;
        this.events = events;
        this.timeline = timeline;
        this.settings = settings;
        this.summaries = summaries;
    }
    assertSigned(req, url, body) {
        const signature = req.headers[signature_util_js_1.SIGNATURE_HEADER] ??
            req.headers[signature_util_js_1.LEGACY_SIGNATURE_HEADER];
        const signingKey = process.env.SIGNALWIRE_SIGN_KEY;
        if (!signingKey) {
            this.logger.error('SIGNALWIRE_SIGN_KEY is not set — every webhook will be rejected. ' +
                'Copy the Signing Key from the SignalWire dashboard (API Credentials) ' +
                'into server/.env. It is NOT the API token.');
        }
        if (!(0, signature_util_js_1.verifySignature)(signature, url, body, signingKey)) {
            const seen = Object.keys(req.headers).filter((h) => /sign|twilio|signalwire/i.test(h));
            this.logger.warn(`Rejected webhook for ${url} ` +
                `(From=${String(body?.From ?? '?')} To=${String(body?.To ?? '?')}) — ` +
                `signature header ${signature ? 'present but did NOT match' : 'ABSENT'}; ` +
                `candidate headers received: ${seen.length ? seen.join(', ') : 'none'}`);
            throw new common_1.ForbiddenException('Invalid signature');
        }
    }
    async voiceInbound(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).voiceUrl, body);
        const from = String(body.From ?? '');
        const to = String(body.To ?? '');
        const callSid = String(body.CallSid ?? '');
        this.logger.log(`inbound call From=${from} To=${to} CallSid=${callSid}`);
        const route = await this.routing.resolve(to);
        const settings = await this.settings.effectiveFor(route?.companyId ?? null);
        const now = new Date();
        const vars = {
            company: route?.companyName ?? '',
            phone: to,
            hours: (0, phone_hours_util_js_1.describeToday)(settings.weeklyHours, settings.timezone, now),
        };
        const voice = settings.voice || undefined;
        const canTakeVoicemail = !!route && settings.voicemailEnabled;
        const finish = (message) => canTakeVoicemail
            ? (0, laml_util_js_1.sayThenRecord)(`${message} ${(0, phone_message_util_js_1.renderMessage)(settings.voicemailPrompt, vars)}`, {
                voice,
                action: (0, phone_config_js_1.webhookUrls)(process.env).voicemailUrl,
                maxLength: settings.voicemailMaxSeconds,
                timeout: 10,
                finishOnKey: '#',
            })
            : (0, laml_util_js_1.sayAndHangup)(message, { voice });
        const unavailable = () => finish((0, phone_message_util_js_1.renderMessage)(settings.unavailableMessage, vars));
        const target = (0, phone_config_js_1.sipDialTarget)(process.env);
        if (!target) {
            this.logger.error('SIGNALWIRE_SIP_* is not configured — no browser can be rung. ' +
                'Set SIGNALWIRE_SIP_DOMAIN / _USERNAME / _PASSWORD in server/.env.');
            return unavailable();
        }
        if (!route || route.targetUserIds.length === 0) {
            return unavailable();
        }
        const open = !settings.hoursEnabled ||
            (0, phone_hours_util_js_1.isOpenAt)(settings.weeklyHours, settings.timezone, now);
        if (!open) {
            const message = (0, phone_message_util_js_1.renderMessage)(settings.afterHoursMessage, vars);
            if (settings.afterHoursHangUp) {
                this.logger.log(`after hours for ${route.companyName} (${settings.timezone}) — ` +
                    (canTakeVoicemail
                        ? 'message then voicemail'
                        : 'message then hangup'));
                return finish(message);
            }
            this.logger.log(`after hours for ${route.companyName} (${settings.timezone}) — ` +
                'message then ringing anyway');
            return this.ringAndDial(route, from, callSid, message, target, settings, voice, canTakeVoicemail);
        }
        const greeting = settings.playGreeting
            ? (0, phone_message_util_js_1.renderMessage)(settings.greetingMessage, vars)
            : null;
        return this.ringAndDial(route, from, callSid, greeting, target, settings, voice, canTakeVoicemail);
    }
    ringAndDial(route, from, callSid, text, target, settings, voice, takeVoicemail) {
        this.events.broadcastIncomingCall(route.targetUserIds, {
            type: 'incoming-call',
            direction: 'inbound',
            companyId: route.companyId,
            companyName: route.companyName,
            from,
            callSid,
            at: Date.now(),
        });
        this.logger.log(`ringing ${route.companyName} -> users [${route.targetUserIds.join(', ')}]` +
            (route.viaAdminFallback ? ' (admin fallback)' : ''));
        return (0, laml_util_js_1.sayThenDialSip)(text, [{ uri: target }], {
            timeout: settings.ringTimeoutSeconds,
            record: (0, phone_config_js_1.recordMode)(process.env),
            voice,
            action: takeVoicemail
                ? (0, phone_config_js_1.webhookUrls)(process.env).dialStatusUrl
                : undefined,
        });
    }
    async dialStatus(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).dialStatusUrl, body);
        const status = body.DialCallStatus ?? '';
        const to = body.To ?? '';
        const callSid = body.CallSid ?? '';
        if (status === 'completed') {
            this.logger.log(`dial completed CallSid=${callSid} — no voicemail`);
            return (0, laml_util_js_1.hangup)();
        }
        const route = await this.routing.resolve(to);
        const settings = await this.settings.effectiveFor(route?.companyId ?? null);
        if (!route || !settings.voicemailEnabled)
            return (0, laml_util_js_1.hangup)();
        const vars = {
            company: route.companyName,
            phone: to,
            hours: (0, phone_hours_util_js_1.describeToday)(settings.weeklyHours, settings.timezone, new Date()),
        };
        this.logger.log(`dial ${status || 'unknown'} CallSid=${callSid} — offering voicemail`);
        return (0, laml_util_js_1.sayThenRecord)((0, phone_message_util_js_1.renderMessage)(settings.voicemailPrompt, vars), {
            voice: settings.voice || undefined,
            action: (0, phone_config_js_1.webhookUrls)(process.env).voicemailUrl,
            maxLength: settings.voicemailMaxSeconds,
            timeout: 10,
            finishOnKey: '#',
        });
    }
    async voicemail(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).voicemailUrl, body);
        this.logger.log(`voicemail CallSid=${body.CallSid ?? ''} ` +
            `duration=${body.RecordingDuration ?? '?'}s ` +
            `sid=${body.RecordingSid ?? '?'}`);
        void this.bustFor(body).catch(() => undefined);
        void this.enqueueSummary(body.CallSid ?? '', body).catch(() => undefined);
        const route = await this.routing.resolve(body.To ?? '');
        const settings = await this.settings.effectiveFor(route?.companyId ?? null);
        return (0, laml_util_js_1.sayAndHangup)('Thank you. Goodbye.', {
            voice: settings.voice || undefined,
        });
    }
    voiceStatus(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).statusCallback, body);
        const callSid = String(body.CallSid ?? '');
        const status = String(body.CallStatus ?? '?');
        this.logger.log(`call status CallSid=${callSid || '?'} ` +
            `status=${status} ` +
            `duration=${String(body.CallDuration ?? '0')}s`);
        if (callSid && TERMINAL_CALL_STATUSES.has(status)) {
            this.events.clearRinging(callSid);
            void this.enqueueSummary(callSid, body).catch(() => undefined);
        }
        void this.bustFor(body).catch(() => undefined);
        return (0, laml_util_js_1.emptyResponse)();
    }
    smsInbound(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).smsUrl, body);
        this.logger.log(`inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')} ` +
            `media=${String(body.NumMedia ?? '0')}`);
        void this.bustFor(body).catch(() => undefined);
        return (0, laml_util_js_1.emptyResponse)();
    }
    async enqueueSummary(callSid, body) {
        if (!callSid)
            return;
        const recordingSid = typeof body.RecordingSid === 'string' && body.RecordingSid
            ? body.RecordingSid
            : null;
        await this.summaries.enqueue({
            callSid,
            companyId: await this.companyFor(body),
            recordingSid,
        });
    }
    async companyFor(body) {
        for (const candidate of [body.To, body.From]) {
            const value = typeof candidate === 'string' ? candidate : '';
            if (!value.startsWith('+'))
                continue;
            const route = await this.routing.resolve(value);
            if (route)
                return route.companyId;
        }
        return null;
    }
    async bustFor(body) {
        for (const candidate of [body.To, body.From]) {
            const value = typeof candidate === 'string' ? candidate : '';
            if (!value.startsWith('+'))
                continue;
            const route = await this.routing.resolve(value);
            if (route) {
                this.timeline.bust(route.companyId);
                return;
            }
        }
    }
};
exports.PhoneWebhooksController = PhoneWebhooksController;
__decorate([
    (0, common_1.Post)('voice/inbound'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PhoneWebhooksController.prototype, "voiceInbound", null);
__decorate([
    (0, common_1.Post)('voice/dial-status'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PhoneWebhooksController.prototype, "dialStatus", null);
__decorate([
    (0, common_1.Post)('voice/voicemail'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PhoneWebhooksController.prototype, "voicemail", null);
__decorate([
    (0, common_1.Post)('voice/status'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", String)
], PhoneWebhooksController.prototype, "voiceStatus", null);
__decorate([
    (0, common_1.Post)('sms/inbound'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", String)
], PhoneWebhooksController.prototype, "smsInbound", null);
exports.PhoneWebhooksController = PhoneWebhooksController = PhoneWebhooksController_1 = __decorate([
    (0, common_1.Controller)('phone'),
    __metadata("design:paramtypes", [call_routing_service_js_1.CallRoutingService,
        phone_events_service_js_1.PhoneEventsService,
        phone_timeline_service_js_1.PhoneTimelineService,
        phone_settings_service_js_1.PhoneSettingsService,
        call_summary_service_js_1.CallSummaryService])
], PhoneWebhooksController);
//# sourceMappingURL=phone-webhooks.controller.js.map