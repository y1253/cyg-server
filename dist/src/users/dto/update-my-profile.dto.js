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
exports.UpdateMyProfileDto = void 0;
const class_validator_1 = require("class-validator");
class UpdateMyProfileDto {
    phoneE164;
}
exports.UpdateMyProfileDto = UpdateMyProfileDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^\+[1-9]\d{7,14}$/, {
        message: 'phoneE164 must be E.164, e.g. +15145551234',
    }),
    __metadata("design:type", Object)
], UpdateMyProfileDto.prototype, "phoneE164", void 0);
//# sourceMappingURL=update-my-profile.dto.js.map