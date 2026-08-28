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
let PhoneEventsService = PhoneEventsService_1 = class PhoneEventsService {
    logger = new common_1.Logger(PhoneEventsService_1.name);
    clients = new Map();
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
    broadcastIncomingCall(userIds, event) {
        const data = JSON.stringify(event);
        const targets = new Set(userIds);
        let delivered = 0;
        for (const [, client] of this.clients) {
            if (targets.has(client.userId)) {
                client.subject.next({ data });
                delivered++;
            }
        }
        this.logger.log(`incoming-call ${event.from} -> ${event.companyName}: ` +
            `${targets.size} target user(s), ${delivered} open stream(s)`);
    }
};
exports.PhoneEventsService = PhoneEventsService;
exports.PhoneEventsService = PhoneEventsService = PhoneEventsService_1 = __decorate([
    (0, common_1.Injectable)()
], PhoneEventsService);
//# sourceMappingURL=phone-events.service.js.map