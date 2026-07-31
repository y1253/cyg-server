"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationsModule = void 0;
const common_1 = require("@nestjs/common");
const gmail_module_js_1 = require("../gmail/gmail.module.js");
const internal_messages_module_js_1 = require("../internal-messages/internal-messages.module.js");
const microsoft_module_js_1 = require("../microsoft/microsoft.module.js");
const communications_controller_js_1 = require("./communications.controller.js");
const outbound_cleanup_service_js_1 = require("./outbound-cleanup.service.js");
const provider_resolver_service_js_1 = require("./provider-resolver.service.js");
let CommunicationsModule = class CommunicationsModule {
};
exports.CommunicationsModule = CommunicationsModule;
exports.CommunicationsModule = CommunicationsModule = __decorate([
    (0, common_1.Module)({
        imports: [gmail_module_js_1.GmailModule, microsoft_module_js_1.MicrosoftModule, internal_messages_module_js_1.InternalMessagesModule],
        controllers: [communications_controller_js_1.CommunicationsController],
        providers: [provider_resolver_service_js_1.ProviderResolverService, outbound_cleanup_service_js_1.OutboundCleanupService],
        exports: [provider_resolver_service_js_1.ProviderResolverService],
    })
], CommunicationsModule);
//# sourceMappingURL=communications.module.js.map