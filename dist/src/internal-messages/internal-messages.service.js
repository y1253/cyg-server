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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalMessagesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const uploads_js_1 = require("./uploads.js");
const PAGE_SIZE = 30;
const SNIPPET_LENGTH = 200;
const messageInclude = {
    sender: { select: { id: true, name: true, email: true } },
    recipients: {
        include: { user: { select: { id: true, name: true, email: true } } },
    },
    attachments: {
        select: { id: true, filename: true, mimeType: true, size: true },
    },
};
let InternalMessagesService = class InternalMessagesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    sseClients = new Map();
    snippet(m) {
        const text = (m.bodyText ?? '').replace(/\s+/g, ' ').trim();
        return text.length > SNIPPET_LENGTH
            ? `${text.slice(0, SNIPPET_LENGTH)}…`
            : text;
    }
    toSummary(m, viewerId) {
        const mine = m.recipients.find((r) => r.userId === viewerId);
        const isOwn = m.senderId === viewerId;
        return {
            id: m.id,
            threadId: m.threadId ?? m.id,
            parentId: m.parentId,
            subject: m.subject,
            date: m.createdAt.toISOString(),
            snippet: this.snippet(m),
            isOwn,
            isForward: m.isForward,
            isRead: isOwn ? true : mine?.readAt != null,
            isCompleted: isOwn ? true : mine?.completedAt != null,
            from: m.sender,
            to: m.recipients
                .filter((r) => r.kind === client_1.InternalRecipientKind.TO)
                .map((r) => r.user),
            cc: m.recipients
                .filter((r) => r.kind === client_1.InternalRecipientKind.CC)
                .map((r) => r.user),
            attachments: m.attachments,
        };
    }
    toDetail(m, viewerId, forwards = []) {
        return {
            ...this.toSummary(m, viewerId),
            bodyHtml: m.bodyHtml,
            bodyText: m.bodyText,
            isForwarded: forwards.length > 0,
            forwards,
        };
    }
    async loadForwards(parentIds, viewerId) {
        const byParent = new Map();
        if (parentIds.length === 0)
            return byParent;
        const rows = await this.prisma.internalMessage.findMany({
            where: {
                AND: [
                    this.visibleToViewer(viewerId),
                    { parentId: { in: parentIds }, isForward: true },
                ],
            },
            include: messageInclude,
            orderBy: { id: 'asc' },
        });
        for (const row of rows) {
            const list = byParent.get(row.parentId) ?? [];
            list.push({
                messageId: row.id,
                at: row.createdAt.toISOString(),
                to: row.recipients
                    .filter((r) => r.kind === client_1.InternalRecipientKind.TO)
                    .map((r) => r.user.name)
                    .join(', '),
                by: { id: row.sender.id, name: row.sender.name },
            });
            byParent.set(row.parentId, list);
        }
        return byParent;
    }
    visibleToViewer(viewerId) {
        return {
            deletedAt: null,
            OR: [
                { senderId: viewerId },
                { recipients: { some: { userId: viewerId } } },
            ],
        };
    }
    async loadVisible(id, viewerId) {
        const message = await this.prisma.internalMessage.findFirst({
            where: { id, ...this.visibleToViewer(viewerId) },
            include: messageInclude,
        });
        if (!message)
            throw new common_1.NotFoundException('Message not found');
        return message;
    }
    folderWhere(folder, viewerId) {
        switch (folder) {
            case 'SENT':
                return { deletedAt: null, senderId: viewerId };
            case 'UNREAD':
                return {
                    deletedAt: null,
                    recipients: { some: { userId: viewerId, readAt: null } },
                };
            case 'UNCOMPLETED':
                return {
                    deletedAt: null,
                    recipients: { some: { userId: viewerId, completedAt: null } },
                };
            case 'INBOX':
            default:
                return {
                    deletedAt: null,
                    recipients: { some: { userId: viewerId } },
                };
        }
    }
    async list(viewerId, folder, cursor, q) {
        const search = q?.trim();
        const messages = await this.prisma.internalMessage.findMany({
            where: {
                ...this.folderWhere(folder, viewerId),
                ...(search && {
                    OR: [
                        { subject: { contains: search } },
                        { bodyText: { contains: search } },
                    ],
                }),
            },
            include: messageInclude,
            orderBy: { id: 'desc' },
            take: PAGE_SIZE + 1,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        });
        const hasMore = messages.length > PAGE_SIZE;
        const page = hasMore ? messages.slice(0, PAGE_SIZE) : messages;
        return {
            messages: page.map((m) => this.toSummary(m, viewerId)),
            nextCursor: hasMore ? page[page.length - 1].id : null,
        };
    }
    async getOne(id, viewerId) {
        const message = await this.loadVisible(id, viewerId);
        const forwards = await this.loadForwards([message.id], viewerId);
        return this.toDetail(message, viewerId, forwards.get(message.id) ?? []);
    }
    async getThread(threadId, viewerId) {
        const messages = await this.prisma.internalMessage.findMany({
            where: {
                AND: [
                    this.visibleToViewer(viewerId),
                    { OR: [{ threadId }, { id: threadId }] },
                ],
            },
            include: messageInclude,
            orderBy: { id: 'asc' },
        });
        const forwards = await this.loadForwards(messages.map((m) => m.id), viewerId);
        return {
            messages: messages.map((m) => this.toDetail(m, viewerId, forwards.get(m.id) ?? [])),
        };
    }
    async getUncompletedCount(viewerId) {
        return this.prisma.internalMessageRecipient.count({
            where: {
                userId: viewerId,
                completedAt: null,
                message: { deletedAt: null },
            },
        });
    }
    async getUnreadCount(viewerId) {
        return this.prisma.internalMessageRecipient.count({
            where: { userId: viewerId, readAt: null, message: { deletedAt: null } },
        });
    }
    async setState(id, viewerId, data) {
        const visible = await this.prisma.internalMessage.findFirst({
            where: { id, ...this.visibleToViewer(viewerId) },
            select: { id: true },
        });
        if (!visible)
            throw new common_1.NotFoundException('Message not found');
        await this.prisma.internalMessageRecipient.updateMany({
            where: { messageId: id, userId: viewerId },
            data,
        });
    }
    markRead(id, viewerId) {
        return this.setState(id, viewerId, { readAt: new Date() });
    }
    markUnread(id, viewerId) {
        return this.setState(id, viewerId, { readAt: null });
    }
    markComplete(id, viewerId) {
        return this.setState(id, viewerId, { completedAt: new Date() });
    }
    markUncomplete(id, viewerId) {
        return this.setState(id, viewerId, { completedAt: null });
    }
    async send(senderId, input, files) {
        const toIds = input.to.filter((id) => id !== senderId);
        const ccIds = input.cc.filter((id) => id !== senderId && !toIds.includes(id));
        const allIds = [...toIds, ...ccIds];
        if (allIds.length === 0) {
            await this.discardFiles(files);
            throw new common_1.BadRequestException('At least one recipient is required');
        }
        const users = await this.prisma.user.findMany({
            where: { id: { in: allIds }, deletedAt: null },
            select: { id: true },
        });
        if (users.length !== allIds.length) {
            await this.discardFiles(files);
            throw new common_1.BadRequestException('One or more recipients no longer exist');
        }
        let threadId = null;
        if (input.parentId) {
            const parent = await this.prisma.internalMessage.findFirst({
                where: { id: input.parentId, ...this.visibleToViewer(senderId) },
                select: { id: true, threadId: true },
            });
            if (!parent) {
                await this.discardFiles(files);
                throw new common_1.NotFoundException('Message being replied to was not found');
            }
            threadId = input.isForward ? null : (parent.threadId ?? parent.id);
        }
        const message = await this.prisma.$transaction(async (tx) => {
            const created = await tx.internalMessage.create({
                data: {
                    senderId,
                    subject: input.subject?.trim() || '(no subject)',
                    bodyText: input.body,
                    bodyHtml: input.bodyHtml ?? null,
                    parentId: input.parentId ?? null,
                    isForward: input.isForward ?? false,
                    threadId,
                    recipients: {
                        create: [
                            ...toIds.map((userId) => ({
                                userId,
                                kind: client_1.InternalRecipientKind.TO,
                            })),
                            ...ccIds.map((userId) => ({
                                userId,
                                kind: client_1.InternalRecipientKind.CC,
                            })),
                        ],
                    },
                    ...(files.length && {
                        attachments: {
                            create: files.map((f) => ({
                                filename: f.originalname,
                                mimeType: f.mimetype,
                                size: f.size,
                                storagePath: path.posix.join(uploads_js_1.MESSAGES_SUBDIR, f.filename),
                            })),
                        },
                    }),
                },
                include: messageInclude,
            });
            if (threadId === null) {
                return tx.internalMessage.update({
                    where: { id: created.id },
                    data: { threadId: created.id },
                    include: messageInclude,
                });
            }
            return created;
        });
        for (const userId of allIds)
            this.broadcastNewMessage(userId);
        return this.toDetail(message, senderId);
    }
    async discardFiles(files) {
        await Promise.allSettled(files.map((f) => (0, promises_1.unlink)(f.path)));
    }
    async getAttachment(attachmentId, viewerId) {
        const attachment = await this.prisma.internalMessageAttachment.findFirst({
            where: {
                id: attachmentId,
                message: this.visibleToViewer(viewerId),
            },
        });
        if (!attachment)
            throw new common_1.NotFoundException('Attachment not found');
        return {
            ...attachment,
            absolutePath: (0, uploads_js_1.resolveStoredPath)(attachment.storagePath),
        };
    }
    addSseClient(id, userId, subject) {
        this.sseClients.set(id, { userId, subject });
    }
    removeSseClient(id) {
        this.sseClients.delete(id);
    }
    broadcastNewMessage(userId) {
        for (const [, client] of this.sseClients) {
            if (client.userId === userId) {
                client.subject.next({ data: JSON.stringify({ type: 'new-message' }) });
            }
        }
    }
};
exports.InternalMessagesService = InternalMessagesService;
exports.InternalMessagesService = InternalMessagesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], InternalMessagesService);
//# sourceMappingURL=internal-messages.service.js.map