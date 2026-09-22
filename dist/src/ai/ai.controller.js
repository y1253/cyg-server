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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const ai_service_js_1 = require("./ai.service.js");
const polish_reply_dto_js_1 = require("./dto/polish-reply.dto.js");
const translate_dto_js_1 = require("./dto/translate.dto.js");
const ai_config_js_1 = require("./ai.config.js");
const transcribe_upload_js_1 = require("./transcribe-upload.js");
let AiController = class AiController {
    aiService;
    constructor(aiService) {
        this.aiService = aiService;
    }
    config() {
        return {
            assist: (0, ai_config_js_1.aiAssist)(process.env),
            transcribeInbound: (0, ai_config_js_1.aiTranscribeInbound)(process.env),
        };
    }
    polishReply(dto) {
        return this.aiService.polishReply(dto);
    }
    async transcribe(file) {
        if (!(0, ai_config_js_1.aiAssist)(process.env)) {
            throw new common_1.BadRequestException('AI assistance is switched off.');
        }
        if (!file)
            throw new common_1.BadRequestException('No recording was uploaded.');
        const text = await this.aiService.transcribeAudio(file.buffer, file.originalname || 'dictation.webm', file.mimetype);
        return { text };
    }
    async translate(dto) {
        if (!(0, ai_config_js_1.aiAssist)(process.env)) {
            throw new common_1.BadRequestException('AI assistance is switched off.');
        }
        const translated = await this.aiService.translateToEnglish(dto.text, (0, ai_config_js_1.summaryOrPolishModel)(process.env));
        return { translated };
    }
};
exports.AiController = AiController;
__decorate([
    (0, common_1.Get)('config'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AiController.prototype, "config", null);
__decorate([
    (0, common_1.Post)('polish-reply'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [polish_reply_dto_js_1.PolishReplyDto]),
    __metadata("design:returntype", void 0)
], AiController.prototype, "polishReply", null);
__decorate([
    (0, common_1.Post)('transcribe'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        limits: { fileSize: transcribe_upload_js_1.MAX_TRANSCRIBE_BYTES, files: 1 },
        fileFilter: transcribe_upload_js_1.transcribeFileFilter,
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "transcribe", null);
__decorate([
    (0, common_1.Post)('translate'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [translate_dto_js_1.TranslateDto]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "translate", null);
exports.AiController = AiController = __decorate([
    (0, common_1.Controller)('ai'),
    __metadata("design:paramtypes", [ai_service_js_1.AiService])
], AiController);
//# sourceMappingURL=ai.controller.js.map