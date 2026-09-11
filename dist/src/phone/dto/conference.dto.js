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
exports.PartyDto = exports.PartyHoldDto = exports.AddCallDto = void 0;
const class_validator_1 = require("class-validator");
class AddCallDto {
    targetUserId;
    phone;
    contactId;
}
exports.AddCallDto = AddCallDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AddCallDto.prototype, "targetUserId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\+[1-9]\d{7,14}$/, {
        message: 'phone must be an E.164 number, e.g. +14382561210',
    }),
    __metadata("design:type", String)
], AddCallDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AddCallDto.prototype, "contactId", void 0);
class PartyHoldDto {
    partyId;
    held;
}
exports.PartyHoldDto = PartyHoldDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PartyHoldDto.prototype, "partyId", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PartyHoldDto.prototype, "held", void 0);
class PartyDto {
    partyId;
}
exports.PartyDto = PartyDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PartyDto.prototype, "partyId", void 0);
//# sourceMappingURL=conference.dto.js.map