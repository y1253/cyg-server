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
exports.UpdateCompanyPhoneSettingsDto = void 0;
const class_validator_1 = require("class-validator");
const phone_settings_validators_js_1 = require("../phone-settings.validators.js");
class UpdateCompanyPhoneSettingsDto {
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
}
exports.UpdateCompanyPhoneSettingsDto = UpdateCompanyPhoneSettingsDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, phone_settings_validators_js_1.IsIanaTimeZone)(),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, phone_settings_validators_js_1.IsWeeklyHours)(),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "weeklyHours", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "greetingMessage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "afterHoursMessage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "unavailableMessage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "playGreeting", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "afterHoursHangUp", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "hoursEnabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(5),
    (0, class_validator_1.Max)(120),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "ringTimeoutSeconds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, value) => value !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", Object)
], UpdateCompanyPhoneSettingsDto.prototype, "voice", void 0);
//# sourceMappingURL=update-company-phone-settings.dto.js.map