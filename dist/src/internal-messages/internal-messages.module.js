"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalMessagesModule = void 0;
const common_1 = require("@nestjs/common");
const internal_messages_controller_js_1 = require("./internal-messages.controller.js");
const internal_messages_service_js_1 = require("./internal-messages.service.js");
const uploads_js_1 = require("./uploads.js");
let InternalMessagesModule = class InternalMessagesModule {
    onModuleInit() {
        (0, uploads_js_1.ensureUploadDirs)();
    }
};
exports.InternalMessagesModule = InternalMessagesModule;
exports.InternalMessagesModule = InternalMessagesModule = __decorate([
    (0, common_1.Module)({
        controllers: [internal_messages_controller_js_1.InternalMessagesController],
        providers: [internal_messages_service_js_1.InternalMessagesService],
        exports: [internal_messages_service_js_1.InternalMessagesService],
    })
], InternalMessagesModule);
//# sourceMappingURL=internal-messages.module.js.map