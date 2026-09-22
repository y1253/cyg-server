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
var WhatsAppPublicController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppPublicController = void 0;
const common_1 = require("@nestjs/common");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const object_storage_service_js_1 = require("../storage/object-storage.service.js");
const stored_object_js_1 = require("../storage/stored-object.js");
const whatsapp_messages_service_js_1 = require("./whatsapp-messages.service.js");
const whatsapp_util_js_1 = require("./whatsapp.util.js");
let WhatsAppPublicController = WhatsAppPublicController_1 = class WhatsAppPublicController {
    messages;
    storage;
    logger = new common_1.Logger(WhatsAppPublicController_1.name);
    constructor(messages, storage) {
        this.messages = messages;
        this.storage = storage;
    }
    verify(query, res) {
        const expected = (0, whatsapp_util_js_1.whatsappConfig)(process.env).verifyToken;
        if (!expected) {
            this.logger.error('webhook verification refused: WHATSAPP_VERIFY_TOKEN is not set');
            res.status(common_1.HttpStatus.FORBIDDEN).send('Forbidden');
            return;
        }
        if (query['hub.mode'] === 'subscribe' &&
            query['hub.verify_token'] === expected) {
            res
                .status(common_1.HttpStatus.OK)
                .type('text/plain')
                .send(query['hub.challenge'] ?? '');
            return;
        }
        this.logger.warn('webhook verification refused: token mismatch');
        res.status(common_1.HttpStatus.FORBIDDEN).send('Forbidden');
    }
    receive(req, signature) {
        const secret = (0, whatsapp_util_js_1.whatsappConfig)(process.env).appSecret;
        if (!secret) {
            this.logger.error('webhook rejected: WHATSAPP_SECRET is not set');
            throw new common_1.ForbiddenException();
        }
        if (!(0, whatsapp_util_js_1.verifyMetaSignature)(req.rawBody, signature, secret)) {
            this.logger.warn(`webhook rejected: signature ${signature ? 'mismatched' : 'absent'}, raw body ${req.rawBody ? 'present' : 'ABSENT'}`);
            throw new common_1.ForbiddenException();
        }
        const changes = (0, whatsapp_util_js_1.parseWebhook)(req.body);
        void this.messages
            .ingest(changes)
            .catch((err) => this.logger.error(`webhook ingest failed: ${String(err)}`));
        return 'EVENT_RECEIVED';
    }
    async media(messageId, token, variant, download, range, res) {
        (0, attachment_stream_util_js_1.verifyQueryTokenUser)(token);
        const file = await this.messages.mediaFile(messageId, variant === 'playback' ? 'playback' : 'original');
        await (0, stored_object_js_1.streamStoredObject)(res, this.storage, file.storageKey, {
            mimeType: file.mimeType,
            filename: file.filename,
            disposition: download === '1' ? 'attachment' : 'inline',
            range,
        });
    }
};
exports.WhatsAppPublicController = WhatsAppPublicController;
__decorate([
    (0, common_1.Get)('webhook'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppPublicController.prototype, "verify", null);
__decorate([
    (0, common_1.Post)('webhook'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('x-hub-signature-256')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppPublicController.prototype, "receive", null);
__decorate([
    (0, common_1.Get)('media/:messageId'),
    __param(0, (0, common_1.Param)('messageId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Query)('variant')),
    __param(3, (0, common_1.Query)('download')),
    __param(4, (0, common_1.Headers)('range')),
    __param(5, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WhatsAppPublicController.prototype, "media", null);
exports.WhatsAppPublicController = WhatsAppPublicController = WhatsAppPublicController_1 = __decorate([
    (0, common_1.Controller)('whatsapp'),
    __metadata("design:paramtypes", [whatsapp_messages_service_js_1.WhatsAppMessagesService,
        object_storage_service_js_1.ObjectStorageService])
], WhatsAppPublicController);
//# sourceMappingURL=whatsapp-public.controller.js.map