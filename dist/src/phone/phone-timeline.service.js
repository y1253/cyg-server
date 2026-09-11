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
var PhoneTimelineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneTimelineService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const sms_opt_out_service_js_1 = require("./sms-opt-out.service.js");
const message_state_service_js_1 = require("../communications/message-state.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const phone_config_js_1 = require("./phone.config.js");
const signalwire_parse_js_1 = require("./signalwire-parse.js");
const phone_timeline_util_js_1 = require("./phone-timeline.util.js");
const recording_token_util_js_1 = require("./recording-token.util.js");
let PhoneTimelineService = class PhoneTimelineService {
    static { PhoneTimelineService_1 = this; }
    prisma;
    signalwire;
    state;
    optOuts;
    logger = new common_1.Logger(PhoneTimelineService_1.name);
    constructor(prisma, signalwire, state, optOuts) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.state = state;
        this.optOuts = optOuts;
    }
    static TTL_MS = 45_000;
    static HISTORIC_TTL_MS = 5 * 60_000;
    static MAX_ENTRIES = 300;
    static COUNT_WINDOW_MS = 30 * 24 * 60 * 60_000;
    cache = new Map();
    inFlight = new Map();
    bust(companyId) {
        for (const key of [...this.cache.keys()]) {
            if (key.startsWith(`${companyId}|`))
                this.cache.delete(key);
        }
    }
    async activeNumber(companyId) {
        const row = await this.prisma.supportNumber.findFirst({
            where: { companyId, releasedAt: null },
            orderBy: { id: 'desc' },
            select: { phoneNumber: true },
        });
        return row?.phoneNumber ?? null;
    }
    async loadWindow(companyId, supportNumber, before) {
        const key = `${companyId}|${before ?? 'HEAD'}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < cached.ttl)
            return cached.rows;
        const running = this.inFlight.get(key);
        if (running)
            return running;
        const sipTarget = (0, phone_config_js_1.sipDialTarget)(process.env);
        const promise = (async () => {
            const started = Date.now();
            const [callsTo, callsFrom, smsTo, smsFrom, sipLegs, recordings] = await Promise.all([
                this.signalwire.listCalls({ to: supportNumber, before }),
                this.signalwire.listCalls({ from: supportNumber, before }),
                this.signalwire.listMessages({ to: supportNumber, before }),
                this.signalwire.listMessages({ from: supportNumber, before }),
                sipTarget
                    ? this.signalwire.listCalls({ to: `sip:${sipTarget}`, before })
                    : Promise.resolve([]),
                this.signalwire.listRecordings({ before }).catch((err) => {
                    this.logger.warn(`recordings lookup failed for company ${companyId} — every row in this ` +
                        `window will report no recording: ${err instanceof Error ? err.message : String(err)}`);
                    return [];
                }),
            ]);
            const rows = {
                calls: [...callsTo, ...callsFrom],
                sipLegs,
                messages: [...smsTo, ...smsFrom],
                recordings,
                truncated: [callsTo, callsFrom, smsTo, smsFrom].some((list) => list.length >= 200),
            };
            this.logger.log(`timeline company=${companyId} ${before ? 'page' : 'head'} ` +
                `calls=${rows.calls.length} sms=${rows.messages.length} ` +
                `sipLegs=${sipLegs.length} recordings=${rows.recordings.length} ` +
                `${Date.now() - started}ms`);
            return rows;
        })().finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, promise);
        const rows = await promise;
        this.evictStale();
        this.cache.set(key, {
            at: Date.now(),
            ttl: before
                ? PhoneTimelineService_1.HISTORIC_TTL_MS
                : PhoneTimelineService_1.TTL_MS,
            rows,
        });
        return rows;
    }
    evictStale() {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.at > entry.ttl)
                this.cache.delete(key);
        }
        while (this.cache.size >= PhoneTimelineService_1.MAX_ENTRIES) {
            const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (!oldest)
                break;
            this.cache.delete(oldest[0]);
        }
    }
    async contactNamesFor(companyId) {
        try {
            const rows = await this.prisma.contact.findMany({
                where: { companyId, deletedAt: null, phoneE164: { not: null } },
                select: { phoneE164: true, name: true },
                orderBy: { name: 'asc' },
            });
            return new Map(rows.map((r) => [r.phoneE164, r.name]));
        }
        catch (err) {
            this.logger.warn(`contactNamesFor(${companyId}) failed, rows will show numbers: ${String(err)}`);
            return new Map();
        }
    }
    async itemsFor(companyId, supportNumber, before) {
        const [window, readIds, completedIds, contactNames] = await Promise.all([
            this.loadWindow(companyId, supportNumber, before),
            this.state.getReadSet(companyId),
            this.state.getCompletedSet(companyId),
            this.contactNamesFor(companyId),
        ]);
        return {
            items: (0, phone_timeline_util_js_1.buildPhoneItems)({
                supportNumber,
                calls: window.calls,
                sipLegs: window.sipLegs,
                messages: window.messages,
                recordings: window.recordings,
                minRecordingSec: (0, phone_config_js_1.minRecordingSeconds)(process.env),
                readIds,
                completedIds,
                contactNames,
            }),
            truncated: window.truncated,
        };
    }
    async getTimeline(companyId, beforeIso, limit = 25) {
        const supportNumber = await this.activeNumber(companyId);
        if (!supportNumber) {
            return {
                items: [],
                nextCursor: null,
                hasMore: false,
                hasNumber: false,
                supportNumber: null,
            };
        }
        const before = beforeIso ? new Date(beforeIso).getTime() : undefined;
        const beforeMs = Number.isFinite(before) ? before : undefined;
        let { items, truncated } = await this.itemsFor(companyId, supportNumber, undefined);
        const eligibleFrom = (rows) => beforeMs === undefined
            ? rows
            : rows.filter((i) => new Date(i.at).getTime() < beforeMs);
        let eligible = eligibleFrom(items);
        if (beforeMs !== undefined && eligible.length < limit && truncated) {
            const deeper = await this.itemsFor(companyId, supportNumber, beforeMs);
            items = deeper.items;
            truncated = deeper.truncated;
            eligible = eligibleFrom(items);
        }
        const page = eligible.slice(0, limit);
        const hasMore = eligible.length > limit || (page.length > 0 && truncated);
        return {
            items: page,
            nextCursor: page.length > 0 ? page[page.length - 1].at : null,
            hasMore,
            hasNumber: true,
            supportNumber,
        };
    }
    async getCounts(companyId) {
        const supportNumber = await this.activeNumber(companyId);
        if (!supportNumber)
            return { unread: 0, uncompleted: 0 };
        const { items } = await this.itemsFor(companyId, supportNumber, undefined);
        const since = Date.now() - PhoneTimelineService_1.COUNT_WINDOW_MS;
        const recent = items.filter((i) => new Date(i.at).getTime() >= since);
        return {
            unread: recent.filter((i) => !i.isRead).length,
            uncompleted: recent.filter((i) => !i.isCompleted).length,
        };
    }
    async getUnreadItems(companyId, limit) {
        const supportNumber = await this.activeNumber(companyId);
        if (!supportNumber)
            return [];
        const { items } = await this.itemsFor(companyId, supportNumber, undefined);
        const since = Date.now() - PhoneTimelineService_1.COUNT_WINDOW_MS;
        return items
            .filter((i) => !i.isRead && new Date(i.at).getTime() >= since)
            .slice(0, limit);
    }
    countsAll = null;
    countsAllInFlight = null;
    static COUNTS_ALL_TTL_MS = 55_000;
    static COUNTS_ALL_CONCURRENCY = 4;
    async getUncompletedCountsForAll() {
        const cached = this.countsAll;
        if (cached &&
            Date.now() - cached.at < PhoneTimelineService_1.COUNTS_ALL_TTL_MS) {
            return cached.map;
        }
        if (this.countsAllInFlight)
            return this.countsAllInFlight;
        const run = this.sweepUncompletedCounts()
            .then((map) => {
            this.countsAll = { at: Date.now(), map };
            return map;
        })
            .finally(() => {
            this.countsAllInFlight = null;
        });
        this.countsAllInFlight = run;
        return run;
    }
    async sweepUncompletedCounts() {
        const rows = await this.prisma.supportNumber.findMany({
            where: { releasedAt: null },
            select: { companyId: true },
        });
        const ids = [...new Set(rows.map((r) => r.companyId))];
        const out = {};
        let next = 0;
        const worker = async () => {
            while (next < ids.length) {
                const companyId = ids[next++];
                try {
                    const { uncompleted } = await this.getCounts(companyId);
                    out[companyId] = uncompleted;
                }
                catch (err) {
                    this.logger.warn(`uncompleted phone count failed for company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        };
        await Promise.all(Array.from({
            length: Math.min(PhoneTimelineService_1.COUNTS_ALL_CONCURRENCY, ids.length),
        }, worker));
        return out;
    }
    async getSmsThread(companyId, peer, limit = 200) {
        if (!(0, signalwire_parse_js_1.isE164)(peer)) {
            throw new common_1.BadRequestException('peer must be an E.164 number');
        }
        const supportNumber = await this.activeNumber(companyId);
        if (!supportNumber) {
            return { messages: [], peer, supportNumber: null };
        }
        const [inbound, outbound, readIds, completedIds, contactNames] = await Promise.all([
            this.signalwire.listMessages({ to: supportNumber, from: peer }),
            this.signalwire.listMessages({ to: peer, from: supportNumber }),
            this.state.getReadSet(companyId),
            this.state.getCompletedSet(companyId),
            this.contactNamesFor(companyId),
        ]);
        const messages = (0, phone_timeline_util_js_1.buildPhoneItems)({
            supportNumber,
            calls: [],
            sipLegs: [],
            messages: [...inbound, ...outbound],
            recordings: [],
            readIds,
            completedIds,
            contactNames,
        })
            .filter((i) => i.kind === 'sms')
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
            .slice(-limit);
        return { messages, peer, supportNumber };
    }
    async sendSms(companyId, to, body) {
        const supportNumber = await this.activeNumber(companyId);
        if (!supportNumber) {
            throw new common_1.NotFoundException('This company has no support number');
        }
        if (!(0, signalwire_parse_js_1.isE164)(to)) {
            throw new common_1.BadRequestException('to must be an E.164 number');
        }
        if (to === supportNumber) {
            throw new common_1.BadRequestException('Cannot text the company’s own number');
        }
        if (await this.optOuts.isOptedOut(to)) {
            throw new common_1.BadRequestException('This number has opted out of text messages (replied STOP). They must text ' +
                'START to opt back in before we can message them again.');
        }
        const text = body.trim();
        if (!text)
            throw new common_1.BadRequestException('Message body is required');
        if (text.length > 1600) {
            throw new common_1.BadRequestException('Message is longer than 10 SMS segments');
        }
        const sent = await this.signalwire.sendSms({
            to,
            from: supportNumber,
            body: text,
        });
        this.bust(companyId);
        const [item] = (0, phone_timeline_util_js_1.buildPhoneItems)({
            supportNumber,
            calls: [],
            sipLegs: [],
            messages: [sent],
            recordings: [],
            readIds: new Set(),
            completedIds: new Set(),
            contactNames: await this.contactNamesFor(companyId),
        });
        return item;
    }
    async findRecordingsForCall(callSid, knownCall) {
        const own = await this.signalwire.listRecordings({ callSid });
        if (own.length > 0)
            return { recordings: own, onSid: callSid };
        const call = knownCall ?? (await this.signalwire.getCall(callSid));
        if (!call?.parentCallSid)
            return { recordings: [], onSid: callSid };
        const parent = await this.signalwire.listRecordings({
            callSid: call.parentCallSid,
        });
        return { recordings: parent, onSid: call.parentCallSid };
    }
    async getCallRecordings(companyId, callSid) {
        const call = await this.assertCallBelongsTo(companyId, callSid);
        const { recordings } = await this.findRecordingsForCall(callSid, call);
        const minSec = (0, phone_config_js_1.minRecordingSeconds)(process.env);
        const audible = recordings.filter((r) => (0, phone_timeline_util_js_1.isAudibleRecording)(r, minSec));
        if (audible.length < recordings.length) {
            this.logger.log(`call ${callSid}: ${recordings.length - audible.length} recording(s) under ` +
                `${minSec}s hidden (hang-up at the beep, most likely)`);
        }
        return audible.map((r) => ({
            sid: r.sid,
            durationSec: r.durationSec,
            createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
            token: (0, recording_token_util_js_1.signRecordingToken)(r.sid),
        }));
    }
    async assertCallBelongsTo(companyId, callSid) {
        const supportNumber = await this.activeNumber(companyId);
        if (!supportNumber) {
            throw new common_1.NotFoundException('This company has no support number');
        }
        const call = await this.signalwire.getCall(callSid);
        if (!call)
            throw new common_1.NotFoundException('Call not found');
        if ((0, phone_timeline_util_js_1.legNumber)(call.to) !== supportNumber &&
            (0, phone_timeline_util_js_1.legNumber)(call.from) !== supportNumber) {
            this.logger.warn(`company ${companyId} asked for call ${callSid}, which is not on its number`);
            throw new common_1.NotFoundException('Call not found');
        }
        return call;
    }
};
exports.PhoneTimelineService = PhoneTimelineService;
exports.PhoneTimelineService = PhoneTimelineService = PhoneTimelineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService,
        message_state_service_js_1.MessageStateService,
        sms_opt_out_service_js_1.SmsOptOutService])
], PhoneTimelineService);
//# sourceMappingURL=phone-timeline.service.js.map