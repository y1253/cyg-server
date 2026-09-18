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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateWhatsAppTemplateDto = exports.CreateWhatsAppTemplateDto = exports.SendWhatsAppDto = exports.SendWhatsAppTemplateDto = exports.ConnectWhatsAppDto = void 0;
const class_validator_1 = require("class-validator");
class ConnectWhatsAppDto {
    code;
    wabaId;
    phoneNumberId;
}
exports.ConnectWhatsAppDto = ConnectWhatsAppDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 4096),
    __metadata("design:type", String)
], ConnectWhatsAppDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.Matches)(/^\d{5,30}$/, { message: 'wabaId must be a numeric id' }),
    __metadata("design:type", String)
], ConnectWhatsAppDto.prototype, "wabaId", void 0);
__decorate([
    (0, class_validator_1.Matches)(/^\d{5,30}$/, { message: 'phoneNumberId must be a numeric id' }),
    __metadata("design:type", String)
], ConnectWhatsAppDto.prototype, "phoneNumberId", void 0);
class SendWhatsAppTemplateDto {
    to;
    name;
    language;
    variables;
}
exports.SendWhatsAppTemplateDto = SendWhatsAppTemplateDto;
__decorate([
    (0, class_validator_1.Matches)(/^\d{6,15}$/, { message: 'to must be 6-15 digits' }),
    __metadata("design:type", String)
], SendWhatsAppTemplateDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 512),
    __metadata("design:type", String)
], SendWhatsAppTemplateDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(2, 16),
    __metadata("design:type", String)
], SendWhatsAppTemplateDto.prototype, "language", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], SendWhatsAppTemplateDto.prototype, "variables", void 0);
class SendWhatsAppDto {
    to;
    body;
    replyToMessageId;
}
exports.SendWhatsAppDto = SendWhatsAppDto;
__decorate([
    (0, class_validator_1.Matches)(/^\d{6,15}$/, { message: 'to must be 6-15 digits' }),
    __metadata("design:type", String)
], SendWhatsAppDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 4096),
    __metadata("design:type", String)
], SendWhatsAppDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], SendWhatsAppDto.prototype, "replyToMessageId", void 0);
class CreateWhatsAppTemplateDto {
    name;
    language;
    category;
    body;
    examples;
}
exports.CreateWhatsAppTemplateDto = CreateWhatsAppTemplateDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[a-z0-9_]{1,512}$/, {
        message: 'name may use only lowercase letters, numbers and underscores, e.g. appointment_reminder',
    }),
    __metadata("design:type", String)
], CreateWhatsAppTemplateDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[a-z]{2,3}(_[A-Z]{2})?$/, {
        message: 'language must be a locale like en_US or fr, not en-US',
    }),
    __metadata("design:type", String)
], CreateWhatsAppTemplateDto.prototype, "language", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['UTILITY', 'MARKETING'], {
        message: 'category must be UTILITY or MARKETING',
    }),
    __metadata("design:type", String)
], CreateWhatsAppTemplateDto.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 1024),
    __metadata("design:type", String)
], CreateWhatsAppTemplateDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateWhatsAppTemplateDto.prototype, "examples", void 0);
class GenerateWhatsAppTemplateDto {
    description;
}
exports.GenerateWhatsAppTemplateDto = GenerateWhatsAppTemplateDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(10, 2000),
    __metadata("design:type", String)
], GenerateWhatsAppTemplateDto.prototype, "description", void 0);
//# sourceMappingURL=whatsapp.dto.js.map