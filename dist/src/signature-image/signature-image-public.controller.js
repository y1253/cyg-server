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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureImagePublicController = void 0;
const common_1 = require("@nestjs/common");
const object_storage_service_js_1 = require("../storage/object-storage.service.js");
const stored_object_js_1 = require("../storage/stored-object.js");
const signature_image_service_js_1 = require("./signature-image.service.js");
let SignatureImagePublicController = class SignatureImagePublicController {
    images;
    storage;
    constructor(images, storage) {
        this.images = images;
        this.storage = storage;
    }
    async serve(publicId, range, res) {
        const file = await this.images.streamableByPublicId(publicId);
        await (0, stored_object_js_1.streamStoredObject)(res, this.storage, file.storageKey, {
            mimeType: file.mimeType,
            filename: file.filename,
            disposition: 'inline',
            cacheControl: 'public, max-age=86400',
            range,
        });
    }
};
exports.SignatureImagePublicController = SignatureImagePublicController;
__decorate([
    (0, common_1.Get)(':publicId'),
    __param(0, (0, common_1.Param)('publicId')),
    __param(1, (0, common_1.Headers)('range')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], SignatureImagePublicController.prototype, "serve", null);
exports.SignatureImagePublicController = SignatureImagePublicController = __decorate([
    (0, common_1.Controller)('signature-images/public'),
    __metadata("design:paramtypes", [signature_image_service_js_1.SignatureImageService,
        object_storage_service_js_1.ObjectStorageService])
], SignatureImagePublicController);
//# sourceMappingURL=signature-image-public.controller.js.map