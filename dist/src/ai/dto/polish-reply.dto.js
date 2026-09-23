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
exports.PolishReplyDto = exports.POLISH_KINDS = void 0;
const class_validator_1 = require("class-validator");
exports.POLISH_KINDS = ['email', 'chat', 'sms', 'whatsapp'];
class PolishReplyDto {
    kind;
    draft;
    context;
    maxChars;
}
exports.PolishReplyDto = PolishReplyDto;
__decorate([
    (0, class_validator_1.IsIn)(exports.POLISH_KINDS),
    __metadata("design:type", String)
], PolishReplyDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(8000),
    __metadata("design:type", String)
], PolishReplyDto.prototype, "draft", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16000),
    __metadata("design:type", String)
], PolishReplyDto.prototype, "context", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(20),
    (0, class_validator_1.Max)(8000),
    __metadata("design:type", Number)
], PolishReplyDto.prototype, "maxChars", void 0);
//# sourceMappingURL=polish-reply.dto.js.map