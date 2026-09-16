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
exports.SendWhatsAppDto = exports.SendWhatsAppTemplateDto = exports.ConnectWhatsAppDto = void 0;
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
//# sourceMappingURL=whatsapp.dto.js.map