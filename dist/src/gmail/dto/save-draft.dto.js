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
exports.SaveDraftDto = void 0;
const class_validator_1 = require("class-validator");
const send_email_dto_js_1 = require("./send-email.dto.js");
class SaveDraftDto {
    to;
    subject;
    body;
    bodyHtml;
    cc;
    bcc;
    inReplyTo;
    references;
    threadId;
    forwardedFrom;
    forwardScope;
    replyToMessageId;
    draftKind;
    hasAttachments;
    setAttachments;
}
exports.SaveDraftDto = SaveDraftDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, send_email_dto_js_1.IsEmailList)({ allowEmpty: true }),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "subject", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "bodyHtml", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, send_email_dto_js_1.IsEmailList)({ allowEmpty: true }),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "cc", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, send_email_dto_js_1.IsEmailList)({ allowEmpty: true }),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "bcc", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "inReplyTo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "references", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "threadId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "forwardedFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['message', 'thread']),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "forwardScope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "replyToMessageId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['reply', 'forward']),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "draftKind", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['true', 'false']),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "hasAttachments", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['true', 'false']),
    __metadata("design:type", String)
], SaveDraftDto.prototype, "setAttachments", void 0);
//# sourceMappingURL=save-draft.dto.js.map