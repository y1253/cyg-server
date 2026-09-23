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
var RingGroupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RingGroupService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const call_legs_util_js_1 = require("./call-legs.util.js");
const laml_util_js_1 = require("./laml.util.js");
const call_screen_util_js_1 = require("./call-screen.util.js");
const phone_config_js_1 = require("./phone.config.js");
const phone_timeline_util_js_1 = require("./phone-timeline.util.js");
let RingGroupService = class RingGroupService {
    static { RingGroupService_1 = this; }
    prisma;
    signalwire;
    logger = new common_1.Logger(RingGroupService_1.name);
    static TTL_MS = 10 * 60 * 1000;
    groups = new Map();
    constructor(prisma, signalwire) {
        this.prisma = prisma;
        this.signalwire = signalwire;
    }
    async start(input) {
        this.sweep();
        if (!input.phones.length)
            return;
        const record = {
            callSid: input.callSid,
            companyId: input.companyId,
            companyName: input.companyName,
            supportNumber: input.supportNumber,
            room: (0, call_legs_util_js_1.conferenceRoomFor)(input.callSid),
            legs: [],
            answeredBy: null,
            voice: input.voice,
            at: Date.now(),
        };
        this.groups.set(input.callSid, record);
        const laml = (0, call_screen_util_js_1.whisperDoc)({
            companyName: input.companyName,
            from: input.from,
            fromName: input.fromName,
            action: (0, phone_config_js_1.webhookUrls)(process.env).screenAcceptUrl,
            voice: input.voice,
        });
        await Promise.all(input.phones.map(async (phone) => {
            try {
                const call = await this.signalwire.createCall({
                    to: phone.e164,
                    from: input.supportNumber,
                    laml,
                    statusCallback: (0, phone_config_js_1.webhookUrls)(process.env).statusCallback,
                    timeoutSec: input.ringTimeoutSeconds,
                });
                record.legs.push({
                    legSid: call.sid,
                    userId: phone.userId,
                    e164: phone.e164,
                });
            }
            catch (err) {
                this.logger.error(`ring-group ${input.callSid} could not dial ${phone.e164}: ${String(err)}`);
            }
        }));
        this.logger.log(`ring-group ${input.companyName} (${input.callSid}) -> mobiles [` +
            `${record.legs.map((l) => l.e164).join(', ')}]`);
    }
    async browserAnswered(callSid) {
        const record = this.groups.get(callSid);
        if (!record || record.answeredBy)
            return;
        record.answeredBy = 'browser';
        this.logger.log(`ring-group ${callSid} answered in a browser — cancelling mobiles`);
        await this.cancelLegs(record, null);
    }
    async screenAccept(legSid, digits) {
        const found = this.findByLeg(legSid);
        if (!found) {
            return this.spoken('Sorry, that call is no longer available. Goodbye.');
        }
        const { record, leg } = found;
        if (digits !== '1') {
            return (0, laml_util_js_1.hangup)();
        }
        if (record.answeredBy) {
            return this.spoken('That call has already been answered. Goodbye.', record.voice);
        }
        record.answeredBy = 'mobile';
        this.logger.log(`ring-group ${record.callSid} accepted on ${leg.e164} (user ${leg.userId})`);
        await this.moveCallerToRoom(record);
        await this.markAnsweredOnMobile(record, leg);
        await this.cancelLegs(record, leg.legSid);
        return (0, laml_util_js_1.response)((0, laml_util_js_1.conferenceVerb)(record.room, {
            startOnEnter: true,
            endOnExit: true,
            beep: 'false',
        }));
    }
    forget(callSid) {
        this.groups.delete(callSid);
    }
    has(callSid) {
        return this.groups.has(callSid);
    }
    async moveCallerToRoom(record) {
        try {
            await this.signalwire.updateCall(record.callSid, {
                laml: (0, laml_util_js_1.response)((0, laml_util_js_1.conferenceVerb)(record.room, { startOnEnter: false, endOnExit: true, beep: 'false' }, { record: (0, phone_config_js_1.recordMode)(process.env) })),
            });
        }
        catch (err) {
            this.logger.error(`ring-group ${record.callSid} could not move the caller into ` +
                `${record.room}: ${String(err)}`);
        }
    }
    async markAnsweredOnMobile(record, leg) {
        try {
            await this.prisma.ringGroupAnswer.upsert({
                where: { callSid: record.callSid },
                create: {
                    callSid: record.callSid,
                    companyId: record.companyId,
                    answeredByUserId: leg.userId,
                    answeredOn: leg.e164,
                },
                update: {},
            });
        }
        catch (err) {
            this.logger.error(`ring-group ${record.callSid} answered on ${leg.e164} but the row failed: ` +
                String(err));
        }
    }
    async cancelLegs(record, keepSid) {
        const targets = record.legs.filter((l) => l.legSid !== keepSid);
        if (!targets.length)
            return;
        await Promise.allSettled(targets.map(async (leg) => {
            try {
                const call = await this.signalwire.getCall(leg.legSid);
                const status = call && !phone_timeline_util_js_1.PRE_ANSWER.has(call.status) ? 'completed' : 'canceled';
                await this.signalwire.updateCall(leg.legSid, { status });
            }
            catch (err) {
                this.logger.warn(`ring-group ${record.callSid} could not end ${leg.e164}: ${String(err)}`);
            }
        }));
    }
    findByLeg(legSid) {
        for (const record of this.groups.values()) {
            const leg = record.legs.find((l) => l.legSid === legSid);
            if (leg)
                return { record, leg };
        }
        return null;
    }
    spoken(text, voice) {
        return (0, laml_util_js_1.response)((0, laml_util_js_1.sayVerb)(text, { voice }) + (0, laml_util_js_1.hangupVerb)());
    }
    sweep() {
        const cutoff = Date.now() - RingGroupService_1.TTL_MS;
        for (const [sid, record] of this.groups) {
            if (record.at < cutoff)
                this.groups.delete(sid);
        }
    }
};
exports.RingGroupService = RingGroupService;
exports.RingGroupService = RingGroupService = RingGroupService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService])
], RingGroupService);
//# sourceMappingURL=ring-group.service.js.map