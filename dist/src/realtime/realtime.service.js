"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RealtimeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeService = void 0;
exports.visibleTo = visibleTo;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const HOLD_MS = 25_000;
const MAX_BUFFER = 500;
const EVENT_TTL_MS = 2 * 60_000;
const MAX_WAITERS = 2_000;
let RealtimeService = RealtimeService_1 = class RealtimeService {
    logger = new common_1.Logger(RealtimeService_1.name);
    seq = 0;
    buffer = [];
    waiters = new Set();
    events$ = new rxjs_1.Subject();
    publish(topic, opts = {}) {
        try {
            const event = {
                seq: ++this.seq,
                at: Date.now(),
                topic,
                ...(opts.companyId !== undefined ? { companyId: opts.companyId } : {}),
                ...(opts.userIds ? { userIds: opts.userIds } : {}),
                ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
            };
            this.buffer.push(event);
            this.sweep();
            this.notify(event);
            this.wake(event);
        }
        catch (err) {
            this.logger.warn(`publish ${topic} failed: ${String(err)}`);
        }
    }
    wait(userId, since, holdMs = HOLD_MS) {
        const cursor = since > 0 ? since : 0;
        if (cursor === 0 && this.seq > 0) {
            return Promise.resolve({ seq: this.seq, events: [] });
        }
        const immediate = this.batchFor(userId, cursor);
        if (immediate.reset || immediate.events.length > 0) {
            return Promise.resolve(immediate);
        }
        if (this.waiters.size >= MAX_WAITERS) {
            this.logger.warn(`waiter cap reached (${MAX_WAITERS}); answering empty`);
            return Promise.resolve({ seq: this.seq, events: [] });
        }
        return new Promise((resolve) => {
            const waiter = {
                userId,
                since: cursor,
                resolve,
                timer: setTimeout(() => {
                    this.waiters.delete(waiter);
                    resolve({ seq: this.seq, events: [] });
                }, holdMs),
            };
            this.waiters.add(waiter);
        });
    }
    get waiterCount() {
        return this.waiters.size;
    }
    get cursor() {
        return this.seq;
    }
    notify(event) {
        try {
            this.events$.next(event);
        }
        catch (err) {
            this.logger.warn(`a realtime subscriber threw: ${String(err)}`);
        }
    }
    wake(event) {
        for (const waiter of [...this.waiters]) {
            if (!visibleTo(event, waiter.userId))
                continue;
            this.waiters.delete(waiter);
            clearTimeout(waiter.timer);
            waiter.resolve(this.batchFor(waiter.userId, waiter.since));
        }
    }
    batchFor(userId, since) {
        if (since > this.seq)
            return { seq: this.seq, events: [], reset: true };
        if (since === this.seq)
            return { seq: this.seq, events: [] };
        const oldest = this.buffer[0];
        if (!oldest || oldest.seq > since + 1) {
            return { seq: this.seq, events: [], reset: true };
        }
        const events = this.buffer.filter((e) => e.seq > since && visibleTo(e, userId));
        return { seq: this.seq, events };
    }
    sweep() {
        const cutoff = Date.now() - EVENT_TTL_MS;
        let from = 0;
        while (from < this.buffer.length && this.buffer[from].at < cutoff)
            from++;
        if (this.buffer.length - from > MAX_BUFFER) {
            from = this.buffer.length - MAX_BUFFER;
        }
        if (from > 0)
            this.buffer = this.buffer.slice(from);
    }
};
exports.RealtimeService = RealtimeService;
exports.RealtimeService = RealtimeService = RealtimeService_1 = __decorate([
    (0, common_1.Injectable)()
], RealtimeService);
function visibleTo(event, userId) {
    return !event.userIds || event.userIds.includes(userId);
}
//# sourceMappingURL=realtime.service.js.map