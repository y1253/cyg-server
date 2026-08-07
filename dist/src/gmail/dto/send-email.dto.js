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
exports.SendEmailDto = void 0;
const class_validator_1 = require("class-validator");
function IsEmailList(validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            name: 'isEmailList',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value) {
                    if (typeof value !== 'string')
                        return false;
                    const parts = value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    return parts.length > 0 && parts.every((p) => (0, class_validator_1.isEmail)(p));
                },
                defaultMessage() {
                    return 'each recipient must be a valid email address';
                },
            },
        });
    };
}
class SendEmailDto {
    to;
    subject;
    body;
    bodyHtml;
    cc;
    inReplyTo;
    references;
    threadId;
    forwardedFrom;
    forwardScope;
    replyToMessageId;
}
exports.SendEmailDto = SendEmailDto;
__decorate([
    IsEmailList(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "subject", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "bodyHtml", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    IsEmailList(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "cc", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "inReplyTo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "references", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "threadId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "forwardedFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['message', 'thread']),
    __metadata("design:type", String)
], SendEmailDto.prototype, "forwardScope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendEmailDto.prototype, "replyToMessageId", void 0);
//# sourceMappingURL=send-email.dto.js.map