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
exports.MmsPublicController = void 0;
const common_1 = require("@nestjs/common");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const mms_staging_util_js_1 = require("./mms-staging.util.js");
let MmsPublicController = class MmsPublicController {
    async serve(filename, token, range, res) {
        const absolute = (0, mms_staging_util_js_1.resolveStagedMms)(filename);
        if (!absolute)
            throw new common_1.NotFoundException();
        (0, mms_staging_util_js_1.assertMmsToken)(token, filename);
        await (0, attachment_stream_util_js_1.streamAttachmentFile)(res, absolute, undefined, filename, 'inline', range, 'private, no-store');
    }
};
exports.MmsPublicController = MmsPublicController;
__decorate([
    (0, common_1.Get)(':filename'),
    __param(0, (0, common_1.Param)('filename')),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Headers)('range')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", Promise)
], MmsPublicController.prototype, "serve", null);
exports.MmsPublicController = MmsPublicController = __decorate([
    (0, common_1.Controller)('phone/mms')
], MmsPublicController);
//# sourceMappingURL=mms-public.controller.js.map