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
var ActiveCallsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveCallsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const contacts_service_js_1 = require("../contacts/contacts.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const phone_timeline_util_js_1 = require("./phone-timeline.util.js");
const active_calls_util_js_1 = require("./active-calls.util.js");
let ActiveCallsService = ActiveCallsService_1 = class ActiveCallsService {
    signalwire;
    prisma;
    contacts;
    logger = new common_1.Logger(ActiveCallsService_1.name);
    calls = new Map();
    reconciling = new Set();
    constructor(signalwire, prisma, contacts) {
        this.signalwire = signalwire;
        this.prisma = prisma;
        this.contacts = contacts;
    }
    async claim(input) {
        const { companyId, companyName, supportNumber, userId, peer } = input;
        const now = Date.now();
        const existing = this.current(companyId, now);
        if (existing) {
            this.logger.log(`active-call claim REFUSED ${companyName} (#${companyId}) user=${userId}: ` +
                `already ${existing.direction} ${existing.state} sid=${existing.callSid ?? 'dialing'}`);
            throw new common_1.ConflictException((0, active_calls_util_js_1.busyMessage)(companyName, existing, now));
        }
        const entry = {
            companyId,
            supportNumber,
            callSid: null,
            direction: 'outbound',
            state: 'dialing',
            userId,
            userName: null,
            peer,
            peerName: null,
            startedAt: now,
            answeredAt: null,
            verifiedAt: now,
        };
        this.calls.set(companyId, [...this.list(companyId, now), entry]);
        let live = [];
        try {
            live = await this.liveCallsOn(supportNumber, now - active_calls_util_js_1.ACTIVE_CALL_TTL_MS);
        }
        catch (err) {
            this.logger.warn(`active-call claim ${companyName}: live check failed, using the in-memory map only: ${String(err)}`);
        }
        if (live.length > 0) {
            const seeded = (0, active_calls_util_js_1.entryFromLiveRow)(companyId, supportNumber, live[0], Date.now());
            this.replaceEntry(companyId, entry, seeded);
            this.logger.log(`active-call claim REFUSED ${companyName} (#${companyId}) user=${userId}: SignalWire lists ` +
                `live [${live.map((c) => `${c.sid}:${c.status}`).join(', ')}] with no entry here — seeded`);
            throw new common_1.ConflictException((0, active_calls_util_js_1.busyMessage)(companyName, seeded, Date.now()));
        }
        await this.fillNames(entry, userId).catch(() => undefined);
        this.logger.log(`active-call claim ${companyName} (#${companyId}) user=${userId} -> ${peer}`);
        return {
            commit: (callSid) => {
                if (!this.holds(companyId, entry))
                    return;
                entry.callSid = callSid;
                entry.state = 'active';
                entry.verifiedAt = Date.now();
                this.logger.log(`active-call commit #${companyId} sid=${callSid}`);
            },
            release: () => {
                if (!this.replaceEntry(companyId, entry, null))
                    return;
                this.logger.log(`active-call release #${companyId} (dial failed)`);
            },
        };
    }
    noteInboundRinging(input) {
        const now = Date.now();
        const existing = this.current(input.companyId, now);
        if (existing && existing.direction === 'outbound') {
            this.logger.log(`active-call inbound ${input.callSid} rings #${input.companyId} while outbound ` +
                `${existing.callSid ?? 'dialing'} is live — keeping the outbound entry`);
            return;
        }
        const entry = {
            companyId: input.companyId,
            supportNumber: input.supportNumber,
            callSid: input.callSid,
            direction: 'inbound',
            state: 'ringing',
            userId: null,
            userName: null,
            peer: input.from,
            peerName: input.fromName,
            startedAt: now,
            answeredAt: null,
            verifiedAt: now,
        };
        const others = this.list(input.companyId, now).filter((e) => e.callSid !== input.callSid);
        this.calls.set(input.companyId, [...others, entry]);
        this.logger.log(`active-call inbound ringing #${input.companyId} sid=${input.callSid} from ${input.from}` +
            (others.length ? ` (${others.length} already live — call waiting)` : ''));
    }
    async markAnswered(companyId, callSid, userId) {
        const entry = this.list(companyId, Date.now()).find((e) => e.callSid === callSid);
        if (!entry || entry.direction !== 'inbound')
            return false;
        entry.state = 'active';
        entry.answeredAt = Date.now();
        entry.userId = userId;
        await this.fillNames(entry, userId).catch(() => undefined);
        this.logger.log(`active-call answered #${companyId} sid=${callSid} by user ${userId}`);
        return true;
    }
    get(companyId) {
        const now = Date.now();
        const entry = this.current(companyId, now);
        if (this.list(companyId, now).some((e) => (0, active_calls_util_js_1.needsReconcile)(e, now))) {
            void this.reconcile(companyId).catch(() => undefined);
        }
        return entry;
    }
    async onTerminalStatus(callSid, to, from) {
        const companyId = this.findCompany(callSid, to, from);
        if (companyId === null)
            return;
        if (this.list(companyId, Date.now()).length > 1) {
            this.dropSid(companyId, callSid);
        }
        const kept = await this.reconcile(companyId);
        if (kept) {
            const retry = setTimeout(() => void this.reconcile(companyId).catch(() => undefined), active_calls_util_js_1.TERMINAL_RETRY_MS);
            retry.unref?.();
        }
    }
    async reconcile(companyId) {
        const entries = this.list(companyId, Date.now());
        const entry = entries[0];
        if (!entry)
            return false;
        if (this.reconciling.has(companyId))
            return true;
        this.reconciling.add(companyId);
        try {
            const live = await this.liveCallsOn(entry.supportNumber, Math.min(...entries.map((e) => e.startedAt)) - active_calls_util_js_1.LIVE_LOOKBACK_MS);
            const still = this.list(companyId, Date.now());
            if (still.length === 0)
                return false;
            const now = Date.now();
            const kept = still.filter((e) => !(0, active_calls_util_js_1.shouldClear)(e, live.length, now));
            if (kept.length !== still.length) {
                if (kept.length === 0)
                    this.calls.delete(companyId);
                else
                    this.calls.set(companyId, kept);
                this.logger.log(`active-call reconcile #${companyId} cleared ${still.length - kept.length} ` +
                    `(nothing live on ${entry.supportNumber})`);
                if (kept.length === 0)
                    return false;
            }
            for (const e of kept)
                e.verifiedAt = now;
            this.logger.log(`active-call reconcile #${companyId} kept ${kept.map((e) => e.state).join('+')} live=[` +
                `${live.map((c) => `${c.sid}:${c.status}`).join(', ')}]`);
            return true;
        }
        catch (err) {
            this.logger.warn(`active-call reconcile #${companyId} failed, keeping the entry: ${String(err)}`);
            return true;
        }
        finally {
            this.reconciling.delete(companyId);
        }
    }
    holds(companyId, entry) {
        return this.calls.get(companyId)?.includes(entry) ?? false;
    }
    replaceEntry(companyId, entry, next) {
        const entries = this.calls.get(companyId);
        if (!entries?.includes(entry))
            return false;
        const updated = entries.flatMap((e) => e === entry ? (next ? [next] : []) : [e]);
        if (updated.length === 0)
            this.calls.delete(companyId);
        else
            this.calls.set(companyId, updated);
        return true;
    }
    list(companyId, now) {
        const entries = this.calls.get(companyId);
        if (!entries)
            return [];
        const live = entries.filter((e) => !(0, active_calls_util_js_1.isExpired)(e, now));
        if (live.length !== entries.length) {
            this.logger.warn(`active-call #${companyId} expired ${entries.length - live.length} entr(y/ies) ` +
                `after ${active_calls_util_js_1.ACTIVE_CALL_TTL_MS / 3_600_000}h with no end seen`);
            if (live.length === 0)
                this.calls.delete(companyId);
            else
                this.calls.set(companyId, live);
        }
        return live;
    }
    current(companyId, now) {
        const live = this.list(companyId, now);
        if (live.length === 0)
            return null;
        const rank = (e) => (e.state === 'ringing' ? 0 : 1);
        return [...live].sort((a, b) => rank(b) - rank(a) || b.startedAt - a.startedAt)[0];
    }
    findCompany(callSid, to, from) {
        if (callSid) {
            for (const entry of this.everyEntry()) {
                if (entry.callSid === callSid)
                    return entry.companyId;
            }
        }
        const numbers = new Set([(0, phone_timeline_util_js_1.legNumber)(to), (0, phone_timeline_util_js_1.legNumber)(from)].filter((n) => !!n));
        for (const entry of this.everyEntry()) {
            if (numbers.has(entry.supportNumber))
                return entry.companyId;
        }
        return null;
    }
    *everyEntry() {
        for (const entries of this.calls.values())
            yield* entries;
    }
    dropSid(companyId, callSid) {
        const entries = this.calls.get(companyId);
        if (!entries)
            return false;
        const kept = entries.filter((e) => e.callSid !== callSid);
        if (kept.length === entries.length)
            return false;
        if (kept.length === 0)
            this.calls.delete(companyId);
        else
            this.calls.set(companyId, kept);
        this.logger.log(`active-call #${companyId} dropped ended call ${callSid}`);
        return true;
    }
    async liveCallsOn(number, since) {
        const [fromRows, toRows] = await Promise.all([
            this.signalwire.listCalls({ from: number, after: since }),
            this.signalwire.listCalls({ to: number, after: since }),
        ]);
        const bySid = new Map();
        for (const row of [...fromRows, ...toRows])
            bySid.set(row.sid, row);
        return (0, active_calls_util_js_1.liveOnly)([...bySid.values()]);
    }
    async fillNames(entry, userId) {
        const [user, peerName] = await Promise.all([
            this.prisma.user.findFirst({ where: { id: userId }, select: { name: true } }),
            entry.peer
                ? this.contacts.nameForNumber(entry.companyId, entry.peer)
                : Promise.resolve(null),
        ]);
        if (entry.userId === userId)
            entry.userName = user?.name ?? null;
        if (peerName)
            entry.peerName = peerName;
    }
};
exports.ActiveCallsService = ActiveCallsService;
exports.ActiveCallsService = ActiveCallsService = ActiveCallsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [signalwire_service_js_1.SignalWireService,
        prisma_service_js_1.PrismaService,
        contacts_service_js_1.ContactsService])
], ActiveCallsService);
//# sourceMappingURL=active-calls.service.js.map