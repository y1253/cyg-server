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
var InternalCallsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalCallsService = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const signalwire_service_js_1 = require("../phone/signalwire.service.js");
const phone_events_service_js_1 = require("../phone/phone-events.service.js");
const laml_util_js_1 = require("../phone/laml.util.js");
const phone_config_js_1 = require("../phone/phone.config.js");
const recording_token_util_js_1 = require("../phone/recording-token.util.js");
const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);
let InternalCallsService = class InternalCallsService {
    static { InternalCallsService_1 = this; }
    prisma;
    signalwire;
    events;
    logger = new common_1.Logger(InternalCallsService_1.name);
    static RING_TIMEOUT = 30;
    constructor(prisma, signalwire, events) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.events = events;
    }
    async startCall(callerId, calleeId) {
        if (callerId === calleeId) {
            throw new common_1.BadRequestException('You cannot call yourself');
        }
        const [caller, callee] = await Promise.all([
            this.prisma.user.findFirst({
                where: { id: callerId, deletedAt: null },
                select: {
                    id: true,
                    name: true,
                    internalWorkspace: { select: { id: true } },
                },
            }),
            this.prisma.user.findFirst({
                where: { id: calleeId, deletedAt: null },
                select: {
                    id: true,
                    name: true,
                    internalWorkspace: { select: { id: true } },
                },
            }),
        ]);
        if (!caller)
            throw new common_1.NotFoundException('User not found');
        if (!callee)
            throw new common_1.NotFoundException('That person is no longer available');
        const target = (0, phone_config_js_1.sipDialTarget)(process.env);
        if (!target) {
            this.logger.error('SIGNALWIRE_SIP_* is not configured — no browser can be rung. ' +
                'Set SIGNALWIRE_SIP_DOMAIN / _USERNAME / _PASSWORD in server/.env.');
            throw new common_1.ServiceUnavailableException('Softphone is not configured on the server');
        }
        const token = (0, crypto_1.randomUUID)();
        const laml = (0, laml_util_js_1.dialSip)([{ uri: target, headers: { 'X-Cyg-Call': token } }], {
            timeout: InternalCallsService_1.RING_TIMEOUT,
            record: (0, phone_config_js_1.recordMode)(process.env),
        });
        const call = await this.signalwire.createCall({
            to: `sip:${target}`,
            from: `sip:${target}`,
            laml,
            statusCallback: (0, phone_config_js_1.webhookUrls)(process.env).statusCallback,
            timeoutSec: InternalCallsService_1.RING_TIMEOUT,
        });
        try {
            await this.prisma.internalCall.create({
                data: { callSid: call.sid, token, callerId, calleeId },
            });
        }
        catch (err) {
            this.logger.error(`internal call placed but NOT recorded: sid=${call.sid} ` +
                `caller=${callerId} callee=${calleeId} — ${String(err)}`);
        }
        this.logger.log(`internal call ${caller.name} -> ${callee.name} sid=${call.sid}`);
        const at = Date.now();
        this.events.broadcastOutgoingCall(callerId, {
            type: 'outgoing-call',
            direction: 'outbound',
            companyId: caller.internalWorkspace?.id ?? 0,
            companyName: callee.name,
            from: caller.name,
            to: callee.name,
            callSid: call.sid,
            at,
        });
        this.events.broadcastIncomingCall([calleeId], {
            type: 'incoming-call',
            direction: 'inbound',
            companyId: callee.internalWorkspace?.id ?? 0,
            companyName: caller.name,
            from: caller.name,
            callSid: call.sid,
            at,
            token,
        });
        return { callSid: call.sid, peer: { id: callee.id, name: callee.name } };
    }
    async list(userId, limit = 50) {
        const rows = await this.prisma.internalCall.findMany({
            where: { OR: [{ callerId: userId }, { calleeId: userId }] },
            orderBy: { startedAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 100),
            include: {
                caller: { select: { id: true, name: true } },
                callee: { select: { id: true, name: true } },
            },
        });
        const filled = await this.backfillPending(rows);
        return rows.map((row) => {
            const outbound = row.callerId === userId;
            const peer = outbound ? row.callee : row.caller;
            const patch = filled.get(row.callSid);
            const status = patch?.status ?? row.status;
            const durationSec = patch?.durationSec ?? row.durationSec;
            return {
                sid: row.callSid,
                direction: outbound ? 'outbound' : 'inbound',
                peer: { id: peer.id, name: peer.name },
                at: row.startedAt.toISOString(),
                durationSec,
                status,
                outcome: this.outcomeOf(status, durationSec),
            };
        });
    }
    async recordings(userId, callSid) {
        await this.assertParticipant(userId, callSid);
        const recordings = await this.signalwire.listRecordings({ callSid });
        return recordings.map((r) => ({
            sid: r.sid,
            durationSec: r.durationSec,
            createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
            token: (0, recording_token_util_js_1.signRecordingToken)(r.sid),
        }));
    }
    async backfillPending(rows) {
        const filled = new Map();
        const cutoff = Date.now() - InternalCallsService_1.RING_TIMEOUT * 1000 - 5_000;
        const pending = rows.filter((r) => r.status === null && r.startedAt.getTime() < cutoff);
        if (!pending.length)
            return filled;
        await Promise.all(pending.map(async (row) => {
            try {
                const call = await this.signalwire.getCall(row.callSid);
                if (!call)
                    return;
                filled.set(row.callSid, {
                    status: call.status,
                    durationSec: call.durationSec,
                });
                await this.prisma.internalCall.updateMany({
                    where: { callSid: row.callSid },
                    data: {
                        status: call.status,
                        durationSec: call.durationSec,
                        endedAt: new Date(),
                    },
                });
            }
            catch (err) {
                this.logger.warn(`could not backfill internal call ${row.callSid}: ${String(err)}`);
            }
        }));
        return filled;
    }
    async assertParticipant(userId, callSid) {
        const row = await this.prisma.internalCall.findFirst({
            where: { callSid, OR: [{ callerId: userId }, { calleeId: userId }] },
        });
        if (!row) {
            this.logger.warn(`user ${userId} asked for internal call ${callSid}, which is not theirs`);
            throw new common_1.NotFoundException('Call not found');
        }
        return row;
    }
    outcomeOf(status, durationSec) {
        if (status === null)
            return 'in-progress';
        if (UNCONNECTED.has(status))
            return 'missed';
        return (durationSec ?? 0) > 0 ? 'answered' : 'missed';
    }
};
exports.InternalCallsService = InternalCallsService;
exports.InternalCallsService = InternalCallsService = InternalCallsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService,
        phone_events_service_js_1.PhoneEventsService])
], InternalCallsService);
//# sourceMappingURL=internal-calls.service.js.map