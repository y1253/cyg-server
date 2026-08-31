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
var PhoneDialerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneDialerService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const company_phone_access_util_js_1 = require("./company-phone-access.util.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const phone_events_service_js_1 = require("./phone-events.service.js");
const phone_timeline_service_js_1 = require("./phone-timeline.service.js");
const phone_config_js_1 = require("./phone.config.js");
const laml_util_js_1 = require("./laml.util.js");
const signalwire_parse_js_1 = require("./signalwire-parse.js");
let PhoneDialerService = class PhoneDialerService {
    static { PhoneDialerService_1 = this; }
    prisma;
    signalwire;
    events;
    timeline;
    logger = new common_1.Logger(PhoneDialerService_1.name);
    constructor(prisma, signalwire, events, timeline) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.events = events;
        this.timeline = timeline;
    }
    static RING_TIMEOUT = 30;
    async startCall(companyId, to, userId) {
        if (!(0, signalwire_parse_js_1.isE164)(to)) {
            throw new common_1.BadRequestException('to must be an E.164 number');
        }
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
            select: {
                id: true,
                businessName: true,
                assignments: { select: { userId: true } },
            },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        await (0, company_phone_access_util_js_1.assertMayUseCompanyPhone)(this.prisma, company.assignments, userId, company.businessName, 'dial out');
        const number = await this.prisma.supportNumber.findFirst({
            where: { companyId, releasedAt: null },
            orderBy: { id: 'desc' },
            select: { phoneNumber: true },
        });
        if (!number) {
            throw new common_1.NotFoundException('This company has no support number');
        }
        if (to === number.phoneNumber) {
            throw new common_1.BadRequestException('Cannot call the company’s own number');
        }
        const sipTarget = (0, phone_config_js_1.sipDialTarget)(process.env);
        if (!sipTarget) {
            this.logger.error('SIGNALWIRE_SIP_* is not configured — no browser can be rung');
            throw new common_1.ServiceUnavailableException('Softphone is not configured on the server');
        }
        const laml = (0, laml_util_js_1.dialNumber)(to, {
            callerId: number.phoneNumber,
            timeout: PhoneDialerService_1.RING_TIMEOUT,
            record: (0, phone_config_js_1.recordMode)(process.env),
        });
        const call = await this.signalwire.createCall({
            to: `sip:${sipTarget}`,
            from: number.phoneNumber,
            laml,
            statusCallback: (0, phone_config_js_1.webhookUrls)(process.env).statusCallback,
            timeoutSec: PhoneDialerService_1.RING_TIMEOUT,
        });
        this.logger.log(`outbound call ${number.phoneNumber} -> ${to} for ${company.businessName} ` +
            `by user ${userId} sid=${call.sid}`);
        this.events.broadcastOutgoingCall(userId, {
            type: 'outgoing-call',
            direction: 'outbound',
            companyId,
            companyName: company.businessName,
            from: number.phoneNumber,
            to,
            callSid: call.sid,
            at: Date.now(),
        });
        this.timeline.bust(companyId);
        return { callSid: call.sid, to, companyName: company.businessName };
    }
};
exports.PhoneDialerService = PhoneDialerService;
exports.PhoneDialerService = PhoneDialerService = PhoneDialerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService,
        phone_events_service_js_1.PhoneEventsService,
        phone_timeline_service_js_1.PhoneTimelineService])
], PhoneDialerService);
//# sourceMappingURL=phone-dialer.service.js.map