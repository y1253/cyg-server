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
exports.UpdatePhoneDefaultsDto = void 0;
const class_validator_1 = require("class-validator");
const phone_settings_validators_js_1 = require("../phone-settings.validators.js");
class UpdatePhoneDefaultsDto {
    timezone;
    weeklyHours;
    greetingMessage;
    afterHoursMessage;
    unavailableMessage;
    playGreeting;
    afterHoursHangUp;
    hoursEnabled;
    ringTimeoutSeconds;
    voice;
    holdAudioId;
    voicemailEnabled;
    voicemailPrompt;
    voicemailMaxSeconds;
}
exports.UpdatePhoneDefaultsDto = UpdatePhoneDefaultsDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, phone_settings_validators_js_1.IsIanaTimeZone)(),
    __metadata("design:type", String)
], UpdatePhoneDefaultsDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, phone_settings_validators_js_1.IsWeeklyHours)(),
    __metadata("design:type", Array)
], UpdatePhoneDefaultsDto.prototype, "weeklyHours", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], UpdatePhoneDefaultsDto.prototype, "greetingMessage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], UpdatePhoneDefaultsDto.prototype, "afterHoursMessage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], UpdatePhoneDefaultsDto.prototype, "unavailableMessage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdatePhoneDefaultsDto.prototype, "playGreeting", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdatePhoneDefaultsDto.prototype, "afterHoursHangUp", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdatePhoneDefaultsDto.prototype, "hoursEnabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(5),
    (0, class_validator_1.Max)(120),
    __metadata("design:type", Number)
], UpdatePhoneDefaultsDto.prototype, "ringTimeoutSeconds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], UpdatePhoneDefaultsDto.prototype, "voice", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], UpdatePhoneDefaultsDto.prototype, "holdAudioId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdatePhoneDefaultsDto.prototype, "voicemailEnabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], UpdatePhoneDefaultsDto.prototype, "voicemailPrompt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(10),
    (0, class_validator_1.Max)(600),
    __metadata("design:type", Number)
], UpdatePhoneDefaultsDto.prototype, "voicemailMaxSeconds", void 0);
//# sourceMappingURL=update-phone-defaults.dto.js.map