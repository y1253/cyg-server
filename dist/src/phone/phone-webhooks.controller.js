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
const signature_util_js_1 = require("./signature.util.js");
const phone_config_js_1 = require("./phone.config.js");
let PhoneWebhooksController = PhoneWebhooksController_1 = class PhoneWebhooksController {
    logger = new common_1.Logger(PhoneWebhooksController_1.name);
    assertSigned(signature, url, body) {
        if (!(0, signature_util_js_1.verifySignature)(signature, url, body, process.env.SIGNALWIRE_API_TOKEN)) {
            this.logger.warn(`Rejected unsigned webhook for ${url} ` +
                `(From=${String(body?.From ?? '?')} To=${String(body?.To ?? '?')})`);
            throw new common_1.ForbiddenException('Invalid signature');
        }
    }
    voiceInbound(signature, body) {
        this.assertSigned(signature, (0, phone_config_js_1.webhookUrls)(process.env).voiceUrl, body);
        this.logger.log(`inbound call From=${String(body.From ?? '?')} ` +
            `To=${String(body.To ?? '?')} CallSid=${String(body.CallSid ?? '?')}`);
        return (0, laml_util_js_1.sayAndHangup)('Thank you for calling. Nobody is available to take your call right now. ' +
            'Please leave us an email and we will get back to you shortly.');
    }
    voiceStatus(signature, body) {
        this.assertSigned(signature, (0, phone_config_js_1.webhookUrls)(process.env).statusCallback, body);
        this.logger.log(`call status CallSid=${String(body.CallSid ?? '?')} ` +
            `status=${String(body.CallStatus ?? '?')} ` +
            `duration=${String(body.CallDuration ?? '0')}s`);
        return (0, laml_util_js_1.emptyResponse)();
    }
    smsInbound(signature, body) {
        this.assertSigned(signature, (0, phone_config_js_1.webhookUrls)(process.env).smsUrl, body);
        this.logger.log(`inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')}`);
        return (0, laml_util_js_1.emptyResponse)();
    }
};
exports.PhoneWebhooksController = PhoneWebhooksController;
__decorate([
    (0, common_1.Post)('voice/inbound'),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Headers)(signature_util_js_1.SIGNATURE_HEADER)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", String)
], PhoneWebhooksController.prototype, "voiceInbound", null);
__decorate([
    (0, common_1.Post)('voice/status'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Headers)(signature_util_js_1.SIGNATURE_HEADER)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", String)
], PhoneWebhooksController.prototype, "voiceStatus", null);
__decorate([
    (0, common_1.Post)('sms/inbound'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Content-Type', 'text/xml'),
    __param(0, (0, common_1.Headers)(signature_util_js_1.SIGNATURE_HEADER)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", String)
], PhoneWebhooksController.prototype, "smsInbound", null);
exports.PhoneWebhooksController = PhoneWebhooksController = PhoneWebhooksController_1 = __decorate([
    (0, common_1.Controller)('phone')
], PhoneWebhooksController);
//# sourceMappingURL=phone-webhooks.controller.js.map