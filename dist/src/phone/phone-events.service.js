"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PhoneEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneEventsService = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
let PhoneEventsService = class PhoneEventsService {
    static { PhoneEventsService_1 = this; }
    logger = new common_1.Logger(PhoneEventsService_1.name);
    smsReceived$ = new rxjs_1.Subject();
    emitSms(sms) {
        try {
            this.smsReceived$.next(sms);
        }
        catch (err) {
            this.logger.warn(`an SMS subscriber threw: ${String(err)}`);
        }
    }
    dialCompleted$ = new rxjs_1.Subject();
    emitDialCompleted(e) {
        try {
            this.dialCompleted$.next(e);
        }
        catch (err) {
            this.logger.warn(`a dial-status subscriber threw: ${String(err)}`);
        }
    }
    callEnded$ = new rxjs_1.Subject();
    emitCallEnded(e) {
        try {
            this.callEnded$.next(e);
        }
        catch (err) {
            this.logger.warn(`a call-ended subscriber threw: ${String(err)}`);
        }
    }
    static MAX_VOICE_CODE_CALLS = 3;
    voiceCodeExpectations = new Map();
    expectVoiceCode(e164, ttlMs) {
        const now = Date.now();
        this.voiceCodeExpectations.set(e164, {
            requestedAt: now,
            expiresAt: now + ttlMs,
            taken: 0,
        });
        this.logger.log(`expecting a WhatsApp verification call on ${e164}`);
    }
    clearVoiceCode(e164) {
        this.voiceCodeExpectations.delete(e164);
    }
    takeVoiceCodeExpectation(e164) {
        const found = this.voiceCodeExpectations.get(e164);
        if (!found)
            return null;
        if (Date.now() > found.expiresAt) {
            this.voiceCodeExpectations.delete(e164);
            return null;
        }
        if (found.taken >= PhoneEventsService_1.MAX_VOICE_CODE_CALLS) {
            this.logger.warn(`WhatsApp verification call limit reached on ${e164} — letting calls through`);
            this.voiceCodeExpectations.delete(e164);
            return null;
        }
        found.taken += 1;
        return { requestedAt: found.requestedAt };
    }
    voiceCodeRecorded$ = new rxjs_1.Subject();
    emitVoiceCode(event) {
        try {
            this.voiceCodeRecorded$.next(event);
        }
        catch (err) {
            this.logger.warn(`a voice-code subscriber threw: ${String(err)}`);
        }
    }
    clients = new Map();
    pending = new Map();
    ringingByCompany = new Map();
    static RINGING_TTL_MS = 90_000;
    static PENDING_TTL_MS = 120_000;
    static MAX_EVENTS_PER_KEY = 8;
    takeAllPending(userId) {
        return this.livePending(userId);
    }
    takePending(userId) {
        return this.takeAllPending(userId)[0] ?? null;
    }
    livePending(userId) {
        const events = this.pending.get(userId);
        if (!events)
            return [];
        const cutoff = Date.now() - PhoneEventsService_1.PENDING_TTL_MS;
        const live = events.filter((e) => e.at > cutoff);
        if (live.length === 0)
            this.pending.delete(userId);
        else if (live.length !== events.length)
            this.pending.set(userId, live);
        return live;
    }
    clearPendingFor(userId, callSid) {
        const events = this.pending.get(userId);
        if (!events)
            return;
        const kept = callSid ? events.filter((e) => e.callSid !== callSid) : [];
        if (kept.length === events.length)
            return;
        if (kept.length === 0)
            this.pending.delete(userId);
        else
            this.pending.set(userId, kept);
        this.logger.log(`pending cleared for user ${userId}${callSid ? ` (${callSid})` : ''}`);
    }
    getRinging(companyId, viewerId) {
        for (const event of this.liveRinging(companyId)) {
            if (viewerId !== undefined && event.transferFrom?.id === viewerId)
                continue;
            return event;
        }
        return null;
    }
    liveRinging(companyId) {
        const events = this.ringingByCompany.get(companyId);
        if (!events)
            return [];
        const cutoff = Date.now() - PhoneEventsService_1.RINGING_TTL_MS;
        const live = events.filter((e) => e.at > cutoff);
        if (live.length === 0)
            this.ringingByCompany.delete(companyId);
        else if (live.length !== events.length)
            this.ringingByCompany.set(companyId, live);
        return live;
    }
    withEvent(existing, event) {
        const others = existing.filter((e) => e.callSid !== event.callSid);
        return [event, ...others].slice(0, PhoneEventsService_1.MAX_EVENTS_PER_KEY);
    }
    clearRinging(callSid) {
        for (const [companyId, events] of [...this.ringingByCompany]) {
            const kept = events.filter((e) => e.callSid !== callSid);
            if (kept.length === events.length)
                continue;
            if (kept.length === 0)
                this.ringingByCompany.delete(companyId);
            else
                this.ringingByCompany.set(companyId, kept);
            this.logger.log(`ringing cleared for company ${companyId} (${callSid})`);
        }
        for (const [userId, events] of [...this.pending]) {
            const kept = events.filter((e) => e.callSid !== callSid);
            if (kept.length === events.length)
                continue;
            if (kept.length === 0)
                this.pending.delete(userId);
            else
                this.pending.set(userId, kept);
        }
    }
    addClient(id, userId, subject) {
        this.clients.set(id, { userId, subject });
    }
    removeClient(id) {
        this.clients.delete(id);
    }
    isConnected(userId) {
        for (const [, c] of this.clients)
            if (c.userId === userId)
                return true;
        return false;
    }
    static HEARTBEAT_TTL_MS = 45_000;
    heartbeats = new Map();
    noteHeartbeat(userId, busy) {
        this.heartbeats.set(userId, { at: Date.now(), busy });
    }
    liveHeartbeats() {
        const cutoff = Date.now() - PhoneEventsService_1.HEARTBEAT_TTL_MS;
        const live = new Map();
        for (const [userId, hb] of this.heartbeats) {
            if (hb.at > cutoff)
                live.set(userId, hb.busy);
            else
                this.heartbeats.delete(userId);
        }
        return live;
    }
    presenceFor(userIds) {
        const beats = this.liveHeartbeats();
        const online = userIds.filter((id) => this.isConnected(id) || beats.has(id));
        return {
            userIds: online,
            busyUserIds: userIds.filter((id) => beats.get(id) === true),
        };
    }
    broadcastIncomingCall(userIds, event, opts = {}) {
        const data = JSON.stringify(event);
        const targets = new Set(userIds);
        for (const id of targets)
            this.pending.set(id, this.withEvent(this.livePending(id), event));
        if (event.type === 'incoming-call' && opts.publishToCompany !== false) {
            this.ringingByCompany.set(event.companyId, this.withEvent(this.liveRinging(event.companyId), event));
        }
        let delivered = 0;
        for (const [, client] of this.clients) {
            if (targets.has(client.userId)) {
                client.subject.next({ data });
                delivered++;
            }
        }
        this.logger.log(`${event.type} ${event.direction === 'outbound' ? (event.to ?? '?') : event.from}` +
            ` -> ${event.companyName}: ` +
            `${targets.size} target user(s), ${delivered} open stream(s)`);
    }
    broadcastOutgoingCall(userId, event) {
        this.broadcastIncomingCall([userId], event);
    }
};
exports.PhoneEventsService = PhoneEventsService;
exports.PhoneEventsService = PhoneEventsService = PhoneEventsService_1 = __decorate([
    (0, common_1.Injectable)()
], PhoneEventsService);
//# sourceMappingURL=phone-events.service.js.map