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
exports.CompleteUntilIdDto = exports.CompleteUntilSmsDto = exports.CompleteUntilChatDto = exports.CompleteUntilEmailDto = void 0;
const class_validator_1 = require("class-validator");
class CompleteUntilEmailDto {
    threadId;
    messageId;
}
exports.CompleteUntilEmailDto = CompleteUntilEmailDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CompleteUntilEmailDto.prototype, "threadId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CompleteUntilEmailDto.prototype, "messageId", void 0);
class CompleteUntilChatDto {
    spaceId;
    messageId;
}
exports.CompleteUntilChatDto = CompleteUntilChatDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CompleteUntilChatDto.prototype, "spaceId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CompleteUntilChatDto.prototype, "messageId", void 0);
class CompleteUntilSmsDto {
    peer;
    itemId;
}
exports.CompleteUntilSmsDto = CompleteUntilSmsDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], CompleteUntilSmsDto.prototype, "peer", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CompleteUntilSmsDto.prototype, "itemId", void 0);
class CompleteUntilIdDto {
    messageId;
}
exports.CompleteUntilIdDto = CompleteUntilIdDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsPositive)(),
    __metadata("design:type", Number)
], CompleteUntilIdDto.prototype, "messageId", void 0);
//# sourceMappingURL=complete-until.dto.js.map