"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailSignatureModule = void 0;
const common_1 = require("@nestjs/common");
const signature_image_module_js_1 = require("../signature-image/signature-image.module.js");
const email_signature_controller_js_1 = require("./email-signature.controller.js");
const email_signature_service_js_1 = require("./email-signature.service.js");
let EmailSignatureModule = class EmailSignatureModule {
};
exports.EmailSignatureModule = EmailSignatureModule;
exports.EmailSignatureModule = EmailSignatureModule = __decorate([
    (0, common_1.Module)({
        imports: [signature_image_module_js_1.SignatureImageModule],
        controllers: [email_signature_controller_js_1.EmailSignatureController],
        providers: [email_signature_service_js_1.EmailSignatureService],
        exports: [email_signature_service_js_1.EmailSignatureService],
    })
], EmailSignatureModule);
//# sourceMappingURL=email-signature.module.js.map