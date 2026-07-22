"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrosoftModule = void 0;
const common_1 = require("@nestjs/common");
const microsoft_controller_js_1 = require("./microsoft.controller.js");
const microsoft_service_js_1 = require("./microsoft.service.js");
const message_state_module_js_1 = require("../communications/message-state.module.js");
let MicrosoftModule = class MicrosoftModule {
};
exports.MicrosoftModule = MicrosoftModule;
exports.MicrosoftModule = MicrosoftModule = __decorate([
    (0, common_1.Module)({
        imports: [message_state_module_js_1.MessageStateModule],
        controllers: [microsoft_controller_js_1.MicrosoftController],
        providers: [microsoft_service_js_1.MicrosoftService],
        exports: [microsoft_service_js_1.MicrosoftService],
    })
], MicrosoftModule);
//# sourceMappingURL=microsoft.module.js.map