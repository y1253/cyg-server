"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneSettingsModule = void 0;
const common_1 = require("@nestjs/common");
const phone_settings_controller_js_1 = require("./phone-settings.controller.js");
const phone_settings_service_js_1 = require("./phone-settings.service.js");
let PhoneSettingsModule = class PhoneSettingsModule {
};
exports.PhoneSettingsModule = PhoneSettingsModule;
exports.PhoneSettingsModule = PhoneSettingsModule = __decorate([
    (0, common_1.Module)({
        controllers: [phone_settings_controller_js_1.PhoneSettingsController],
        providers: [phone_settings_service_js_1.PhoneSettingsService],
        exports: [phone_settings_service_js_1.PhoneSettingsService],
    })
], PhoneSettingsModule);
//# sourceMappingURL=phone-settings.module.js.map