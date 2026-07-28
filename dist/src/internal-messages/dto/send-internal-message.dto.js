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
exports.SendInternalMessageDto = void 0;
exports.parseUserIdList = parseUserIdList;
const class_validator_1 = require("class-validator");
function IsUserIdList(validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            name: 'isUserIdList',
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
                    return (parts.length > 0 && parts.every((p) => /^[1-9]\d{0,9}$/.test(p)));
                },
                defaultMessage() {
                    return 'each recipient must be a positive user id';
                },
            },
        });
    };
}
function parseUserIdList(value) {
    if (!value)
        return [];
    const ids = value
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)];
}
class SendInternalMessageDto {
    to;
    cc;
    subject;
    body;
    bodyHtml;
    parentId;
    isForward;
}
exports.SendInternalMessageDto = SendInternalMessageDto;
__decorate([
    IsUserIdList(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    IsUserIdList(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "cc", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "subject", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "bodyHtml", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "parentId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendInternalMessageDto.prototype, "isForward", void 0);
//# sourceMappingURL=send-internal-message.dto.js.map