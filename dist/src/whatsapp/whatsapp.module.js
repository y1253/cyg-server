"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppModule = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_controller_js_1 = require("./whatsapp.controller.js");
const whatsapp_public_controller_js_1 = require("./whatsapp-public.controller.js");
const whatsapp_account_service_js_1 = require("./whatsapp-account.service.js");
const whatsapp_graph_service_js_1 = require("./whatsapp-graph.service.js");
const whatsapp_messages_service_js_1 = require("./whatsapp-messages.service.js");
let WhatsAppModule = class WhatsAppModule {
};
exports.WhatsAppModule = WhatsAppModule;
exports.WhatsAppModule = WhatsAppModule = __decorate([
    (0, common_1.Module)({
        controllers: [whatsapp_controller_js_1.WhatsAppController, whatsapp_public_controller_js_1.WhatsAppPublicController],
        providers: [
            whatsapp_graph_service_js_1.WhatsAppGraphService,
            whatsapp_account_service_js_1.WhatsAppAccountService,
            whatsapp_messages_service_js_1.WhatsAppMessagesService,
        ],
        exports: [whatsapp_messages_service_js_1.WhatsAppMessagesService],
    })
], WhatsAppModule);
//# sourceMappingURL=whatsapp.module.js.map