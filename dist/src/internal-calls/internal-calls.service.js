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
exports.InternalCallsService = exports.internalCallItemId = exports.INTERNAL_CALL_ID_PREFIX = exports.INTERNAL_CALL_FOLDERS = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const signalwire_service_js_1 = require("../phone/signalwire.service.js");
const phone_events_service_js_1 = require("../phone/phone-events.service.js");
const call_control_service_js_1 = require("../phone/call-control.service.js");
const conference_service_js_1 = require("../phone/conference.service.js");
const call_summary_service_js_1 = require("../phone/call-summary.service.js");
const laml_util_js_1 = require("../phone/laml.util.js");
const phone_config_js_1 = require("../phone/phone.config.js");
const recording_token_util_js_1 = require("../phone/recording-token.util.js");
const phone_timeline_util_js_1 = require("../phone/phone-timeline.util.js");
const phone_config_js_2 = require("../phone/phone.config.js");
exports.INTERNAL_CALL_FOLDERS = [
    'INBOX',
    'UNCOMPLETED',
    'UNREAD',
    'SENT',
];
const PAGE_SIZE = 30;
exports.INTERNAL_CALL_ID_PREFIX = 'intcall:';
const internalCallItemId = (sid) => `${exports.INTERNAL_CALL_ID_PREFIX}${sid}`;
exports.internalCallItemId = internalCallItemId;
const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);
let InternalCallsService = class InternalCallsService {
    static { InternalCallsService_1 = this; }
    prisma;
    signalwire;
    events;
    summaries;
    callControl;
    conference;
    logger = new common_1.Logger(InternalCallsService_1.name);
    static RING_TIMEOUT = 30;
    constructor(prisma, signalwire, events, summaries, callControl, conference) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.events = events;
        this.summaries = summaries;
        this.callControl = callControl;
        this.conference = conference;
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
            action: (0, phone_config_js_1.webhookUrls)(process.env).dialStatusUrl,
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
            kind: 'internal',
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
            kind: 'internal',
        });
        return { callSid: call.sid, peer: { id: callee.id, name: callee.name } };
    }
    folderWhere(folder, userId) {
        switch (folder) {
            case 'UNREAD':
                return { calleeId: userId, calleeReadAt: null };
            case 'UNCOMPLETED':
                return { calleeId: userId, calleeCompletedAt: null };
            case 'SENT':
                return { id: -1 };
            default:
                return { OR: [{ callerId: userId }, { calleeId: userId }] };
        }
    }
    async list(userId, folder = 'INBOX', cursor, limit = PAGE_SIZE) {
        const take = Math.min(Math.max(limit, 1), 100);
        const rows = await this.prisma.internalCall.findMany({
            where: this.folderWhere(folder, userId),
            orderBy: { id: 'desc' },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
                caller: { select: { id: true, name: true } },
                callee: { select: { id: true, name: true } },
            },
        });
        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const [filled, recorded] = await Promise.all([
            this.backfillPending(page),
            this.recordedSids(),
        ]);
        return {
            calls: page.map((row) => {
                const outbound = row.callerId === userId;
                const peer = outbound ? row.callee : row.caller;
                const patch = filled.get(row.callSid);
                const status = patch?.status ?? row.status;
                const durationSec = patch?.durationSec ?? row.durationSec;
                return {
                    id: (0, exports.internalCallItemId)(row.callSid),
                    sid: row.callSid,
                    direction: outbound ? 'outbound' : 'inbound',
                    peer: { id: peer.id, name: peer.name },
                    at: row.startedAt.toISOString(),
                    durationSec,
                    status,
                    outcome: this.outcomeOf(status, durationSec),
                    isRead: outbound || row.calleeReadAt != null,
                    isCompleted: outbound || row.calleeCompletedAt != null,
                    hasRecording: recorded.has(row.callSid),
                };
            }),
            nextCursor: hasMore ? page[page.length - 1].id : null,
        };
    }
    recordedCache = null;
    recordedInFlight = null;
    static RECORDED_TTL_MS = 30_000;
    async recordedSids() {
        const cached = this.recordedCache;
        if (cached &&
            Date.now() - cached.at < InternalCallsService_1.RECORDED_TTL_MS) {
            return cached.sids;
        }
        if (this.recordedInFlight)
            return this.recordedInFlight;
        this.recordedInFlight = (async () => {
            try {
                const minSec = (0, phone_config_js_2.minRecordingSeconds)(process.env);
                const rows = await this.signalwire.listRecordings({});
                const sids = new Set(rows
                    .filter((r) => !!r.callSid && (0, phone_timeline_util_js_1.isAudibleRecording)(r, minSec))
                    .map((r) => r.callSid));
                this.recordedCache = { at: Date.now(), sids };
                return sids;
            }
            catch (err) {
                this.logger.warn(`could not list recordings for internal call history: ${String(err)}`);
                return this.recordedCache?.sids ?? new Set();
            }
            finally {
                this.recordedInFlight = null;
            }
        })();
        return this.recordedInFlight;
    }
    async counts(userId) {
        const [unread, uncompleted] = await Promise.all([
            this.prisma.internalCall.count({
                where: { calleeId: userId, calleeReadAt: null },
            }),
            this.prisma.internalCall.count({
                where: { calleeId: userId, calleeCompletedAt: null },
            }),
        ]);
        return { unread, uncompleted };
    }
    async setState(userId, callSid, action) {
        await this.assertParticipant(userId, callSid);
        const now = new Date();
        const data = action === 'read'
            ? { calleeReadAt: now }
            : action === 'unread'
                ? { calleeReadAt: null }
                : action === 'complete'
                    ? { calleeCompletedAt: now }
                    : { calleeCompletedAt: null };
        await this.prisma.internalCall.updateMany({
            where: { callSid, calleeId: userId },
            data,
        });
    }
    async recordings(userId, callSid) {
        await this.assertParticipant(userId, callSid);
        const rows = await this.signalwire.listRecordings({ callSid });
        const summary = await this.summaries.findForCall(callSid);
        return {
            recordings: rows.map((r) => ({
                sid: r.sid,
                durationSec: r.durationSec,
                createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
                token: (0, recording_token_util_js_1.signRecordingToken)(r.sid),
            })),
            summary,
        };
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
    async transferBlind(userId, callSid, targetUserId) {
        const row = await this.assertParticipant(userId, callSid);
        const requester = await this.prisma.user.findFirst({
            where: { id: userId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!requester)
            throw new common_1.NotFoundException('User not found');
        const target = await this.callControl.resolveTarget(targetUserId, userId, [
            row.callerId,
            row.calleeId,
        ]);
        const workspace = await this.prisma.company.findFirst({
            where: { isInternal: true, internalOwnerId: target.id, deletedAt: null },
            select: { id: true },
        });
        return this.callControl.blindTransfer({
            rootSid: callSid,
            kind: 'internal',
            requesterIsCaller: row.callerId === userId,
            requester,
            companyId: workspace?.id ?? 0,
            companyName: requester.name,
        }, target);
    }
    async transferStatus(userId, callSid) {
        await this.assertParticipant(userId, callSid);
        return this.callControl.transferStatus(callSid);
    }
    async conferenceContext(userId, callSid) {
        const row = await this.assertParticipant(userId, callSid);
        const requester = await this.prisma.user.findFirst({
            where: { id: userId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!requester)
            throw new common_1.NotFoundException('User not found');
        const workspace = await this.prisma.company.findFirst({
            where: { isInternal: true, internalOwnerId: userId, deletedAt: null },
            select: { id: true },
        });
        return {
            rootSid: callSid,
            kind: 'internal',
            requesterIsCaller: row.callerId === userId,
            requester,
            companyId: workspace?.id ?? 0,
            companyName: requester.name,
            participants: [row.callerId, row.calleeId],
        };
    }
    async conferenceAdd(userId, callSid, targetUserId) {
        const { participants, ...ctx } = await this.conferenceContext(userId, callSid);
        await this.callControl.resolveTarget(targetUserId, userId, participants);
        return this.conference.addCall(ctx, { userId: targetUserId });
    }
    async conferenceHold(userId, callSid, partyId, held) {
        const { participants: _p, ...ctx } = await this.conferenceContext(userId, callSid);
        return this.conference.setPartyHold(ctx, partyId, held);
    }
    async conferenceSwap(userId, callSid) {
        const { participants: _p, ...ctx } = await this.conferenceContext(userId, callSid);
        return this.conference.swap(ctx);
    }
    async conferenceMerge(userId, callSid) {
        const { participants: _p, ...ctx } = await this.conferenceContext(userId, callSid);
        return this.conference.merge(ctx);
    }
    async conferenceDrop(userId, callSid, partyId) {
        const { participants: _p, ...ctx } = await this.conferenceContext(userId, callSid);
        return this.conference.dropParty(ctx, partyId);
    }
    async conferenceStatus(userId, callSid) {
        await this.assertParticipant(userId, callSid);
        return this.conference.conferenceStatus(callSid);
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
        phone_events_service_js_1.PhoneEventsService,
        call_summary_service_js_1.CallSummaryService,
        call_control_service_js_1.CallControlService,
        conference_service_js_1.ConferenceService])
], InternalCallsService);
//# sourceMappingURL=internal-calls.service.js.map