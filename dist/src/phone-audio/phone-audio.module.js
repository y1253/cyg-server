"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneAudioModule = void 0;
const common_1 = require("@nestjs/common");
const phone_audio_controller_js_1 = require("./phone-audio.controller.js");
const phone_audio_service_js_1 = require("./phone-audio.service.js");
let PhoneAudioModule = class PhoneAudioModule {
};
exports.PhoneAudioModule = PhoneAudioModule;
exports.PhoneAudioModule = PhoneAudioModule = __decorate([
    (0, common_1.Module)({
        controllers: [phone_audio_controller_js_1.PhoneAudioController],
        providers: [phone_audio_service_js_1.PhoneAudioService],
        exports: [phone_audio_service_js_1.PhoneAudioService],
    })
], PhoneAudioModule);
//# sourceMappingURL=phone-audio.module.js.map