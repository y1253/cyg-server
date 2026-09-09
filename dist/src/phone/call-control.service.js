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
var CallControlService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallControlService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const signalwire_service_1 = require("./signalwire.service");
const phone_events_service_1 = require("./phone-events.service");
const call_legs_util_1 = require("./call-legs.util");
const laml_util_1 = require("./laml.util");
const phone_config_1 = require("./phone.config");
let CallControlService = class CallControlService {
    static { CallControlService_1 = this; }
    prisma;
    signalwire;
    events;
    logger = new common_1.Logger(CallControlService_1.name);
    static RING_TIMEOUT = 30;
    static TRANSFER_TTL_MS = 120_000;
    transfers = new Map();
    constructor(prisma, signalwire, events) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.events = events;
    }
    async resolveTarget(targetUserId, requesterId, forbidden = []) {
        if (targetUserId === requesterId) {
            throw new common_1.BadRequestException('You cannot transfer a call to yourself');
        }
        if (forbidden.includes(targetUserId)) {
            throw new common_1.BadRequestException('That person is already on this call');
        }
        const user = await this.prisma.user.findFirst({
            where: { id: targetUserId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!user)
            throw new common_1.NotFoundException('That person is no longer available');
        return user;
    }
    async legsFor(ctx) {
        const root = await this.signalwire.getCall(ctx.rootSid);
        if (!root)
            throw new common_1.NotFoundException('Call not found');
        const rows = await this.signalwire.listCalls({
            parentCallSid: ctx.rootSid,
        });
        const children = rows.filter((c) => c.parentCallSid === ctx.rootSid);
        return (0, call_legs_util_1.classifyLegs)(root, children, ctx.kind, {
            requesterIsCaller: ctx.requesterIsCaller,
        });
    }
    async blindTransfer(ctx, target) {
        const sipTarget = (0, phone_config_1.sipDialTarget)(process.env);
        if (!sipTarget) {
            throw new common_1.BadRequestException('No SIP endpoint is configured, so a call cannot be transferred');
        }
        const legs = await this.legsFor(ctx);
        if (!legs.peerSid) {
            throw new common_1.BadRequestException('This call has not connected yet, so there is nobody to transfer');
        }
        const laml = (0, laml_util_1.dialSip)([{ uri: sipTarget }], {
            timeout: CallControlService_1.RING_TIMEOUT,
            action: (0, phone_config_1.webhookUrls)(process.env).dialStatusUrl,
            record: (0, phone_config_1.recordMode)(process.env),
        });
        await this.signalwire.updateCall(legs.peerSid, { laml });
        this.events.clearPendingFor(ctx.requester.id);
        this.transfers.set(ctx.rootSid, {
            peerSid: legs.peerSid,
            previousAgentSid: legs.agentSid,
            target,
            at: Date.now(),
        });
        this.sweepTransfers();
        this.events.broadcastIncomingCall([target.id], {
            type: 'incoming-call',
            direction: 'inbound',
            companyId: ctx.companyId,
            companyName: ctx.companyName,
            from: await this.counterpartyLabel(legs, ctx),
            callSid: legs.peerSid,
            at: Date.now(),
            transferFrom: { id: ctx.requester.id, name: ctx.requester.name },
            kind: ctx.kind === 'internal' ? 'internal' : 'company',
        });
        if (legs.agentSid && legs.agentSid !== legs.peerSid) {
            try {
                await this.signalwire.updateCall(legs.agentSid, {
                    status: 'completed',
                });
            }
            catch {
                this.logger.warn(`blindTransfer ${ctx.rootSid}: agent leg ${legs.agentSid} did not hang up cleanly`);
            }
        }
        this.logger.log(`blindTransfer ${ctx.rootSid} kind=${ctx.kind} peer=${legs.peerSid} ` +
            `by=${ctx.requester.id} to=${target.id}`);
        return { transferredSid: legs.peerSid, target };
    }
    async transferStatus(rootSid) {
        const record = this.transfers.get(rootSid);
        if (!record ||
            Date.now() - record.at > CallControlService_1.TRANSFER_TTL_MS) {
            return { state: 'ended', targetName: null };
        }
        try {
            const peer = await this.signalwire.getCall(record.peerSid);
            const rows = peer
                ? await this.signalwire.listCalls({ parentCallSid: record.peerSid })
                : [];
            const children = rows.filter((c) => c.parentCallSid === record.peerSid);
            const state = (0, call_legs_util_1.transferStateOf)(peer, children, record);
            if (state !== 'ringing')
                this.transfers.delete(rootSid);
            return { state, targetName: record.target.name };
        }
        catch (err) {
            this.logger.warn(`transferStatus ${rootSid}: ${err instanceof Error ? err.message : String(err)}`);
            return { state: 'ended', targetName: record.target.name };
        }
    }
    sweepTransfers() {
        const cutoff = Date.now() - CallControlService_1.TRANSFER_TTL_MS;
        for (const [sid, record] of this.transfers) {
            if (record.at < cutoff)
                this.transfers.delete(sid);
        }
    }
    async counterpartyLabel(legs, ctx) {
        if (ctx.kind === 'internal') {
            return ctx.companyName;
        }
        const peer = legs.peerSid
            ? await this.signalwire.getCall(legs.peerSid)
            : null;
        return (ctx.kind === 'inbound' ? peer?.from : peer?.to) ?? '';
    }
};
exports.CallControlService = CallControlService;
exports.CallControlService = CallControlService = CallControlService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        signalwire_service_1.SignalWireService,
        phone_events_service_1.PhoneEventsService])
], CallControlService);
//# sourceMappingURL=call-control.service.js.map