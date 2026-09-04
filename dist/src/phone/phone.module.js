"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneModule = void 0;
const common_1 = require("@nestjs/common");
const message_state_module_js_1 = require("../communications/message-state.module.js");
const phone_settings_module_js_1 = require("../phone-settings/phone-settings.module.js");
const phone_audio_module_js_1 = require("../phone-audio/phone-audio.module.js");
const phone_controller_js_1 = require("./phone.controller.js");
const phone_webhooks_controller_js_1 = require("./phone-webhooks.controller.js");
const phone_provisioning_service_js_1 = require("./phone-provisioning.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const call_routing_service_js_1 = require("./call-routing.service.js");
const phone_events_service_js_1 = require("./phone-events.service.js");
const phone_timeline_service_js_1 = require("./phone-timeline.service.js");
const phone_dialer_service_js_1 = require("./phone-dialer.service.js");
const call_summary_service_js_1 = require("./call-summary.service.js");
const ai_module_js_1 = require("../ai/ai.module.js");
let PhoneModule = class PhoneModule {
};
exports.PhoneModule = PhoneModule;
exports.PhoneModule = PhoneModule = __decorate([
    (0, common_1.Module)({
        imports: [
            message_state_module_js_1.MessageStateModule,
            phone_settings_module_js_1.PhoneSettingsModule,
            phone_audio_module_js_1.PhoneAudioModule,
            ai_module_js_1.AiModule,
        ],
        controllers: [phone_controller_js_1.PhoneController, phone_webhooks_controller_js_1.PhoneWebhooksController],
        providers: [
            signalwire_service_js_1.SignalWireService,
            phone_provisioning_service_js_1.PhoneProvisioningService,
            call_routing_service_js_1.CallRoutingService,
            phone_events_service_js_1.PhoneEventsService,
            phone_timeline_service_js_1.PhoneTimelineService,
            phone_dialer_service_js_1.PhoneDialerService,
            call_summary_service_js_1.CallSummaryService,
        ],
        exports: [
            phone_provisioning_service_js_1.PhoneProvisioningService,
            signalwire_service_js_1.SignalWireService,
            phone_events_service_js_1.PhoneEventsService,
            phone_timeline_service_js_1.PhoneTimelineService,
            call_summary_service_js_1.CallSummaryService,
        ],
    })
], PhoneModule);
//# sourceMappingURL=phone.module.js.map