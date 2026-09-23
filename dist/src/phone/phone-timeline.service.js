"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var PhoneTimelineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneTimelineService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const sms_opt_out_service_js_1 = require("./sms-opt-out.service.js");
const message_state_service_js_1 = require("../communications/message-state.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const realtime_service_js_1 = require("../realtime/realtime.service.js");
const phone_config_js_1 = require("./phone.config.js");
const signalwire_parse_js_1 = require("./signalwire-parse.js");
const phone_timeline_util_js_1 = require("./phone-timeline.util.js");
const call_legs_util_js_1 = require("./call-legs.util.js");
const recording_token_util_js_1 = require("./recording-token.util.js");
const sms_media_token_util_js_1 = require("./sms-media-token.util.js");
const mms_staging_util_js_1 = require("./mms-staging.util.js");
const mms_shrink_util_js_1 = require("./mms-shrink.util.js");
const public_base_js_1 = require("../communications/public-base.js");
const pool_util_js_1 = require("../communications/pool.util.js");
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const sharp_1 = __importDefault(require("sharp"));
let PhoneTimelineService = class PhoneTimelineService {
    static { PhoneTimelineService_1 = this; }
    prisma;
    signalwire;
    state;
    optOuts;
    realtime;
    logger = new common_1.Logger(PhoneTimelineService_1.name);
    constructor(prisma, signalwire, state, optOuts, realtime) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.state = state;
        this.optOuts = optOuts;
        this.realtime = realtime;
    }
    static TTL_MS = 45_000;
    static LIVE_TTL_MS = 10_000;
    static HISTORIC_TTL_MS = 5 * 60_000;
    static MAX_ENTRIES = 300;
    static COUNT_WINDOW_MS = 30 * 24 * 60 * 60_000;
    static SMS_MEDIA_CONCURRENCY = 4;
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
            ttl: (0, phone_timeline_util_js_1.windowHasLiveLeg)(rows.calls, rows.sipLegs)
                ? PhoneTimelineService_1.LIVE_TTL_MS
                : before
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
    staffNumbersCache = null;
    static STAFF_NUMBERS_TTL_MS = 60_000;
    async staffNumbers() {
        const cached = this.staffNumbersCache;
        if (cached &&
            Date.now() - cached.at < PhoneTimelineService_1.STAFF_NUMBERS_TTL_MS) {
            return cached.value;
        }
        try {
            const rows = await this.prisma.user.findMany({
                where: { deletedAt: null, phoneE164: { not: null } },
                select: { phoneE164: true },
            });
            const value = new Set(rows.map((r) => r.phoneE164));
            this.staffNumbersCache = { at: Date.now(), value };
            return value;
        }
        catch (err) {
            this.logger.warn(`staffNumbers() failed, ring-group legs may show as rows: ${String(err)}`);
            return new Set();
        }
    }
    async answeredOffBrowserSids(companyId) {
        try {
            const rows = await this.prisma.ringGroupAnswer.findMany({
                where: { companyId },
                select: { callSid: true },
                orderBy: { id: 'desc' },
                take: 1000,
            });
            return new Set(rows.map((r) => r.callSid));
        }
        catch (err) {
            this.logger.warn(`answeredOffBrowserSids(${companyId}) failed, a mobile-answered call may ` +
                `read as missed: ${String(err)}`);
            return new Set();
        }
    }
    async itemsFor(companyId, supportNumber, before) {
        const [window, readIds, completedIds, contactNames, staffNumbers, answeredOffBrowserSids,] = await Promise.all([
            this.loadWindow(companyId, supportNumber, before),
            this.state.getReadSet(companyId),
            this.state.getCompletedSet(companyId),
            this.contactNamesFor(companyId),
            this.staffNumbers(),
            this.answeredOffBrowserSids(companyId),
        ]);
        return {
            items: (0, phone_timeline_util_js_1.hideOwnSmsReplies)((0, phone_timeline_util_js_1.buildPhoneItems)({
                supportNumber,
                calls: window.calls,
                sipLegs: window.sipLegs,
                messages: window.messages,
                recordings: window.recordings,
                minRecordingSec: (0, phone_config_js_1.minRecordingSeconds)(process.env),
                readIds,
                completedIds,
                contactNames,
                staffNumbers,
                answeredOffBrowserSids,
            })),
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
            return { unread: 0, uncompleted: 0, missedUnread: 0 };
        const { items } = await this.itemsFor(companyId, supportNumber, undefined);
        const since = Date.now() - PhoneTimelineService_1.COUNT_WINDOW_MS;
        const recent = items.filter((i) => new Date(i.at).getTime() >= since);
        return {
            unread: recent.filter((i) => !i.isRead).length,
            uncompleted: recent.filter((i) => !i.isCompleted).length,
            missedUnread: recent.filter(phone_timeline_util_js_1.isUnreadMissedCall).length,
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
        return (await this.getCountsForAll()).uncompleted;
    }
    async getMissedUnreadCountsForAll() {
        return (await this.getCountsForAll()).missedUnread;
    }
    async refreshCompanyCounts(companyId) {
        if (!this.countsAll)
            return;
        try {
            const counts = await this.getCounts(companyId);
            const maps = this.countsAll?.maps;
            if (!maps)
                return;
            maps.uncompleted[companyId] = counts.uncompleted;
            maps.missedUnread[companyId] = counts.missedUnread;
        }
        catch (err) {
            this.logger.warn(`could not refresh phone counts for company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async getCountsForAll() {
        const cached = this.countsAll;
        if (cached &&
            Date.now() - cached.at < PhoneTimelineService_1.COUNTS_ALL_TTL_MS) {
            return cached.maps;
        }
        if (this.countsAllInFlight)
            return this.countsAllInFlight;
        const run = this.sweepCounts()
            .then((maps) => {
            this.countsAll = { at: Date.now(), maps };
            return maps;
        })
            .finally(() => {
            this.countsAllInFlight = null;
        });
        this.countsAllInFlight = run;
        return run;
    }
    async sweepCounts() {
        const rows = await this.prisma.supportNumber.findMany({
            where: { releasedAt: null },
            select: { companyId: true },
        });
        const ids = [...new Set(rows.map((r) => r.companyId))];
        const out = { uncompleted: {}, missedUnread: {} };
        let next = 0;
        const worker = async () => {
            while (next < ids.length) {
                const companyId = ids[next++];
                try {
                    const counts = await this.getCounts(companyId);
                    out.uncompleted[companyId] = counts.uncompleted;
                    out.missedUnread[companyId] = counts.missedUnread;
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
        return {
            messages: await this.withMedia(messages),
            peer,
            supportNumber,
        };
    }
    async withMedia(messages) {
        const withAny = messages.filter((m) => m.numMedia > 0);
        if (withAny.length === 0)
            return messages;
        const lists = await (0, pool_util_js_1.pool)(withAny, PhoneTimelineService_1.SMS_MEDIA_CONCURRENCY, async (m) => {
            try {
                return await this.signalwire.listMessageMedia(m.sid);
            }
            catch (err) {
                this.logger.warn(`media list for message ${m.sid} failed: ${String(err)}`);
                return [];
            }
        });
        const byId = new Map(withAny.map((m, i) => [
            m.id,
            lists[i].map((file) => ({
                sid: file.sid,
                contentType: file.contentType,
                token: (0, sms_media_token_util_js_1.signSmsMediaToken)(m.sid, file.sid),
            })),
        ]));
        return messages.map((m) => byId.has(m.id) ? { ...m, media: byId.get(m.id) } : m);
    }
    async sendSms(companyId, to, body, files = []) {
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
        if (!text && files.length === 0) {
            throw new common_1.BadRequestException('Message body is required');
        }
        if (text.length > 1600) {
            throw new common_1.BadRequestException('Message is longer than 10 SMS segments');
        }
        const mediaUrls = files.length > 0 ? await this.publishMms(files) : [];
        const sent = await this.signalwire.sendSms({
            to,
            from: supportNumber,
            body: text,
            mediaUrls,
        });
        this.bust(companyId);
        this.realtime.publish('sms', { companyId });
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
    async publishMms(files) {
        if (files.length > mms_staging_util_js_1.MAX_MMS_FILES) {
            throw new common_1.BadRequestException(`A text message can carry at most ${mms_staging_util_js_1.MAX_MMS_FILES} attachments`);
        }
        const base = (0, public_base_js_1.requirePublicBase)(process.env);
        const budget = (0, mms_shrink_util_js_1.perFileBudget)(mms_staging_util_js_1.MAX_MMS_TOTAL_BYTES, files.length);
        const urls = [];
        for (const file of files) {
            const fitted = await this.fitForMms(file, budget);
            urls.push(`${base}/api/phone/mms/${encodeURIComponent(fitted)}?token=${encodeURIComponent((0, mms_staging_util_js_1.signMmsToken)(fitted))}`);
        }
        return urls;
    }
    async fitForMms(file, budget) {
        if (!(0, mms_shrink_util_js_1.isMmsImage)(file.mimetype, file.filename)) {
            throw new common_1.BadRequestException('A text message can only carry pictures — PNG, JPEG, GIF or WebP.');
        }
        const source = await (0, promises_1.readFile)(file.path);
        if (source.length <= budget)
            return file.filename;
        for (const rung of mms_shrink_util_js_1.MMS_IMAGE_LADDER) {
            try {
                const out = await (0, sharp_1.default)(source, { failOn: 'none' })
                    .rotate()
                    .resize(rung.edge, rung.edge, {
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                    .jpeg({ quality: rung.quality })
                    .toBuffer();
                if (out.length <= budget) {
                    return await this.writeStagedMms(out, '.jpg', file);
                }
            }
            catch (err) {
                this.logger.warn(`mms image re-encode failed: ${String(err)}`);
                break;
            }
        }
        throw new common_1.BadRequestException('That picture is too large to send as a text message, even after shrinking. Try a smaller one.');
    }
    async writeStagedMms(bytes, ext, origin) {
        (0, mms_staging_util_js_1.ensureMmsDir)();
        const filename = `${(0, crypto_1.randomUUID)()}${ext}`;
        await (0, promises_1.writeFile)(path.join(mms_staging_util_js_1.MMS_DIR, filename), bytes);
        origin.derived.push(path.join(mms_staging_util_js_1.MMS_DIR, filename));
        return filename;
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
        return (await this.assertCallBelongsToNumber(companyId, callSid)).call;
    }
    async assertCallBelongsToNumber(companyId, callSid) {
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
        return { call, supportNumber };
    }
    async rowItemIdForCall(call, supportNumber) {
        const own = (0, phone_timeline_util_js_1.rowItemIdFor)(call, supportNumber);
        if (own)
            return own;
        const children = await this.signalwire.listCalls({
            parentCallSid: call.sid,
        });
        const child = (0, call_legs_util_js_1.pickConnectedChild)(children.filter((c) => c.parentCallSid === call.sid &&
            (0, phone_timeline_util_js_1.rowItemIdFor)(c, supportNumber) !== null));
        if (child)
            return (0, phone_timeline_util_js_1.callItemId)(child.sid);
        const rows = await this.signalwire.listCalls({
            from: supportNumber,
            after: call.startedAt - 15_000,
            before: call.startedAt + 15_000,
        });
        const candidates = rows.filter((c) => c.direction === 'outbound-dial' &&
            (0, phone_timeline_util_js_1.rowItemIdFor)(c, supportNumber) !== null);
        if (candidates.length !== 1) {
            this.logger.warn(`call ${call.sid}: ${candidates.length} candidate rows in window, cannot identify one`);
            return null;
        }
        return (0, phone_timeline_util_js_1.callItemId)(candidates[0].sid);
    }
};
exports.PhoneTimelineService = PhoneTimelineService;
exports.PhoneTimelineService = PhoneTimelineService = PhoneTimelineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService,
        message_state_service_js_1.MessageStateService,
        sms_opt_out_service_js_1.SmsOptOutService,
        realtime_service_js_1.RealtimeService])
], PhoneTimelineService);
//# sourceMappingURL=phone-timeline.service.js.map