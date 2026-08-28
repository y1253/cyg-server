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
const HOLDING_MESSAGE = (0, laml_util_js_1.sayAndHangup)('Thank you for calling. Nobody is available to take your call right now. ' +
    'Please leave us an email and we will get back to you shortly.');
let PhoneWebhooksController = PhoneWebhooksController_1 = class PhoneWebhooksController {
    routing;
    events;
    logger = new common_1.Logger(PhoneWebhooksController_1.name);
    constructor(routing, events) {
        this.routing = routing;
        this.events = events;
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
        const target = (0, phone_config_js_1.sipDialTarget)(process.env);
        if (!target) {
            this.logger.error('SIGNALWIRE_SIP_* is not configured — no browser can be rung. ' +
                'Set SIGNALWIRE_SIP_DOMAIN / _USERNAME / _PASSWORD in server/.env.');
            return HOLDING_MESSAGE;
        }
        const route = await this.routing.resolve(to);
        if (!route || route.targetUserIds.length === 0) {
            return HOLDING_MESSAGE;
        }
        this.events.broadcastIncomingCall(route.targetUserIds, {
            type: 'incoming-call',
            companyId: route.companyId,
            companyName: route.companyName,
            from,
            callSid,
            at: Date.now(),
        });
        this.logger.log(`ringing ${route.companyName} -> users [${route.targetUserIds.join(', ')}]` +
            (route.viaAdminFallback ? ' (admin fallback)' : ''));
        return (0, laml_util_js_1.dialSip)([{ uri: target }], { timeout: 30 });
    }
    voiceStatus(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).statusCallback, body);
        this.logger.log(`call status CallSid=${String(body.CallSid ?? '?')} ` +
            `status=${String(body.CallStatus ?? '?')} ` +
            `duration=${String(body.CallDuration ?? '0')}s`);
        return (0, laml_util_js_1.emptyResponse)();
    }
    smsInbound(req, body) {
        this.assertSigned(req, (0, phone_config_js_1.webhookUrls)(process.env).smsUrl, body);
        this.logger.log(`inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')}`);
        return (0, laml_util_js_1.emptyResponse)();
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
        phone_events_service_js_1.PhoneEventsService])
], PhoneWebhooksController);
//# sourceMappingURL=phone-webhooks.controller.js.map