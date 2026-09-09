"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureImageModule = void 0;
const common_1 = require("@nestjs/common");
const signature_image_controller_js_1 = require("./signature-image.controller.js");
const signature_image_public_controller_js_1 = require("./signature-image-public.controller.js");
const signature_image_service_js_1 = require("./signature-image.service.js");
let SignatureImageModule = class SignatureImageModule {
};
exports.SignatureImageModule = SignatureImageModule;
exports.SignatureImageModule = SignatureImageModule = __decorate([
    (0, common_1.Module)({
        controllers: [signature_image_controller_js_1.SignatureImageController, signature_image_public_controller_js_1.SignatureImagePublicController],
        providers: [signature_image_service_js_1.SignatureImageService],
        exports: [signature_image_service_js_1.SignatureImageService],
    })
], SignatureImageModule);
//# sourceMappingURL=signature-image.module.js.map