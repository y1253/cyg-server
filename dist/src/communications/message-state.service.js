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
var MessageStateService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageStateService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
let MessageStateService = class MessageStateService {
    static { MessageStateService_1 = this; }
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    static UNCOMPLETED_TTL_MS = 60_000;
    uncompletedCache = new Map();
    uncompletedInFlight = new Map();
    uncompletedIdsCache = new Map();
    async markChatRead(companyId, messageId) {
        const now = new Date();
        await this.prisma.$executeRaw `
      INSERT INTO ChatMessageReadState (companyId, messageId, readAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE readAt = VALUES(readAt), updatedAt = VALUES(updatedAt)
    `;
    }
    async markChatUnread(companyId, messageId) {
        await this.prisma.$executeRaw `
      DELETE FROM ChatMessageReadState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
    }
    async getReadSet(companyId) {
        const rows = await this.prisma.$queryRaw `
      SELECT messageId FROM ChatMessageReadState WHERE companyId = ${companyId}
    `;
        return new Set(rows.map((r) => r.messageId));
    }
    async markComplete(companyId, messageId) {
        const now = new Date();
        await this.prisma.$executeRaw `
      INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
    `;
        this.bustUncompleted(companyId);
    }
    async markUncomplete(companyId, messageId) {
        await this.prisma.$executeRaw `
      DELETE FROM MessageCompletedState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
        this.bustUncompleted(companyId);
    }
    async getCompletedSet(companyId) {
        const rows = await this.prisma.$queryRaw `
      SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
    `;
        return new Set(rows.map((r) => r.messageId));
    }
    async flushCompleted(companyId, ids) {
        if (ids.length === 0)
            return 0;
        const now = new Date();
        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const values = client_1.Prisma.join(chunk.map((id) => client_1.Prisma.sql `(${companyId}, ${id}, ${now}, ${now})`));
            await this.prisma.$executeRaw `
        INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
        VALUES ${values}
        ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
      `;
        }
        return ids.length;
    }
    async getForwardedSet(companyId) {
        const rows = await this.prisma.$queryRaw `
      SELECT messageId FROM ForwardedMessageState WHERE companyId = ${companyId}
    `;
        return new Set(rows.map((r) => r.messageId));
    }
    async recordForward(companyId, messageId, recipient) {
        const now = new Date();
        await this.prisma.$executeRaw `
      INSERT INTO ForwardedMessageState (companyId, messageId, recipient, forwardedAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${recipient}, ${now}, ${now})
    `;
    }
    async getForwards(companyId, messageId) {
        return this.prisma.$queryRaw `
      SELECT recipient, forwardedAt FROM ForwardedMessageState
      WHERE companyId = ${companyId} AND messageId = ${messageId}
      ORDER BY forwardedAt ASC
    `;
    }
    bustUncompleted(companyId) {
        this.uncompletedCache.delete(companyId);
        this.uncompletedIdsCache.delete(companyId);
    }
    async getUncompletedCount(companyId, compute) {
        const cached = this.uncompletedCache.get(companyId);
        if (cached &&
            Date.now() - cached.at < MessageStateService_1.UNCOMPLETED_TTL_MS) {
            return { count: cached.count };
        }
        const inFlight = this.uncompletedInFlight.get(companyId);
        if (inFlight)
            return inFlight;
        const promise = compute()
            .then((count) => {
            this.uncompletedCache.set(companyId, { count, at: Date.now() });
            return { count };
        })
            .finally(() => this.uncompletedInFlight.delete(companyId));
        this.uncompletedInFlight.set(companyId, promise);
        return promise;
    }
    async getCachedEmailIds(companyId, q, compute) {
        if (!q) {
            const cached = this.uncompletedIdsCache.get(companyId);
            if (cached &&
                Date.now() - cached.at < MessageStateService_1.UNCOMPLETED_TTL_MS) {
                return cached.ids;
            }
        }
        const ids = await compute();
        if (!q)
            this.uncompletedIdsCache.set(companyId, { ids, at: Date.now() });
        return ids;
    }
};
exports.MessageStateService = MessageStateService;
exports.MessageStateService = MessageStateService = MessageStateService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], MessageStateService);
//# sourceMappingURL=message-state.service.js.map