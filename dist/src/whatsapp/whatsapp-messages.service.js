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
var WhatsAppMessagesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppMessagesService = exports.MAX_VOICE_BYTES = exports.WHATSAPP_SUBDIR = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const client_1 = require("@prisma/client");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const uploads_js_1 = require("../internal-messages/uploads.js");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const phone_audio_util_js_1 = require("../phone-audio/phone-audio.util.js");
const whatsapp_account_service_js_1 = require("./whatsapp-account.service.js");
const whatsapp_graph_service_js_1 = require("./whatsapp-graph.service.js");
const whatsapp_util_js_1 = require("./whatsapp.util.js");
exports.WHATSAPP_SUBDIR = 'whatsapp';
exports.MAX_VOICE_BYTES = 16 * 1024 * 1024;
const THREAD_LIMIT = 200;
const MEDIA_MAX_ATTEMPTS = 3;
const MEDIA_RETRY_AFTER_MS = 2 * 60_000;
const MEDIA_RETENTION_MS = 29 * 24 * 60 * 60_000;
const MEDIA_SWEEP_BATCH = 20;
function toItem(row, names) {
    const outbound = row.direction === 'outbound';
    return {
        id: (0, whatsapp_util_js_1.whatsappItemId)(row.id),
        messageId: row.id,
        kind: 'whatsapp',
        direction: outbound ? 'outbound' : 'inbound',
        peer: row.peerWaId,
        peerName: names.get(row.peerWaId) ?? row.profileName ?? null,
        type: row.type,
        body: row.body,
        isVoice: row.isVoice,
        durationSec: row.durationSec,
        hasMedia: row.mediaId !== null || row.storagePath !== null,
        mediaStatus: row.mediaStatus ?? null,
        mimeType: row.mimeType,
        filename: row.filename,
        size: row.size,
        status: row.status ?? null,
        errorCode: row.errorCode,
        at: row.at.toISOString(),
        isRead: outbound || row.readAt !== null,
        isCompleted: outbound || row.completedAt !== null,
    };
}
function toHttpError(err) {
    if (err instanceof whatsapp_graph_service_js_1.WhatsAppGraphError) {
        const message = (0, whatsapp_util_js_1.friendlyGraphMessage)(err.code, err.message);
        if (err.httpStatus === 0)
            throw new common_1.ServiceUnavailableException(message);
        throw new common_1.BadRequestException(message);
    }
    throw err;
}
let WhatsAppMessagesService = WhatsAppMessagesService_1 = class WhatsAppMessagesService {
    prisma;
    graph;
    accounts;
    logger = new common_1.Logger(WhatsAppMessagesService_1.name);
    mediaInFlight = new Set();
    mediaSweepRunning = false;
    constructor(prisma, graph, accounts) {
        this.prisma = prisma;
        this.graph = graph;
        this.accounts = accounts;
    }
    async ingest(changes) {
        for (const change of changes) {
            const account = await this.prisma.whatsAppAccount.findUnique({
                where: { phoneNumberId: change.phoneNumberId },
                select: { companyId: true },
            });
            if (!account) {
                this.logger.warn(`webhook for unconnected phone_number_id ${change.phoneNumberId} dropped ` +
                    `(${change.messages.length} messages, ${change.statuses.length} statuses)`);
                continue;
            }
            for (const m of change.messages) {
                let row;
                try {
                    row = await this.prisma.whatsAppMessage.create({
                        data: {
                            companyId: account.companyId,
                            phoneNumberId: change.phoneNumberId,
                            wamid: m.wamid,
                            direction: 'inbound',
                            peerWaId: m.from,
                            profileName: m.profileName,
                            type: m.type,
                            body: m.body,
                            mediaId: m.mediaId,
                            mimeType: m.mimeType,
                            filename: m.filename,
                            isVoice: m.isVoice,
                            mediaStatus: m.mediaId ? 'pending' : null,
                            at: m.at,
                        },
                    });
                }
                catch (err) {
                    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                        err.code === 'P2002') {
                        continue;
                    }
                    this.logger.error(`storing inbound ${m.wamid} failed: ${String(err)}`);
                    continue;
                }
                this.logger.log(`inbound ${m.type} ${row.id} for company ${account.companyId} from ${m.from}`);
                if (row.mediaId) {
                    void this.fetchMedia(row.id).catch(() => undefined);
                }
            }
            for (const s of change.statuses) {
                await this.applyStatus(s).catch((err) => this.logger.warn(`status ${s.status} for ${s.wamid} failed: ${String(err)}`));
            }
        }
    }
    async applyStatus(s) {
        const row = await this.prisma.whatsAppMessage.findUnique({
            where: { wamid: s.wamid },
            select: { id: true, status: true },
        });
        if (!row)
            return;
        const next = (0, whatsapp_util_js_1.nextDeliveryStatus)(row.status, s.status);
        if (next === row.status)
            return;
        await this.prisma.whatsAppMessage.update({
            where: { id: row.id },
            data: {
                status: next,
                ...(s.errorCode ? { errorCode: s.errorCode } : {}),
            },
        });
    }
    async fetchMedia(messageId) {
        if (this.mediaInFlight.has(messageId))
            return;
        this.mediaInFlight.add(messageId);
        try {
            const row = await this.prisma.whatsAppMessage.findUnique({
                where: { id: messageId },
            });
            if (!row?.mediaId || row.mediaStatus === 'ready')
                return;
            const token = await this.accounts.tokenForPhoneNumber(row.phoneNumberId);
            if (!token)
                throw new Error(`no token for phone number ${row.phoneNumberId}`);
            const { bytes, mimeType } = await this.graph.downloadMedia(row.mediaId, token);
            const mime = row.mimeType ?? mimeType;
            const storagePath = await this.store(bytes, (0, whatsapp_util_js_1.extensionForMime)(mime));
            let playbackPath = null;
            let durationSec = null;
            if (row.type === 'audio') {
                const playback = await this.makePlayback(bytes);
                if (playback.mp3)
                    playbackPath = await this.store(playback.mp3, '.mp3');
                durationSec = playback.durationSec;
            }
            await this.prisma.whatsAppMessage.update({
                where: { id: row.id },
                data: {
                    storagePath,
                    playbackPath,
                    durationSec,
                    size: bytes.length,
                    mimeType: mime,
                    mediaStatus: 'ready',
                },
            });
        }
        catch (err) {
            const updated = await this.prisma.whatsAppMessage
                .update({
                where: { id: messageId },
                data: { mediaAttempts: { increment: 1 } },
                select: { mediaAttempts: true },
            })
                .catch(() => null);
            if (updated && updated.mediaAttempts >= MEDIA_MAX_ATTEMPTS) {
                await this.prisma.whatsAppMessage
                    .update({ where: { id: messageId }, data: { mediaStatus: 'failed' } })
                    .catch(() => undefined);
            }
            this.logger.warn(`media for message ${messageId} failed (attempt ${updated?.mediaAttempts ?? '?'}): ${String(err)}`);
        }
        finally {
            this.mediaInFlight.delete(messageId);
        }
    }
    async retryPendingMedia() {
        if (this.mediaSweepRunning)
            return;
        this.mediaSweepRunning = true;
        try {
            const now = Date.now();
            await this.prisma.whatsAppMessage.updateMany({
                where: {
                    mediaStatus: 'pending',
                    createdAt: { lt: new Date(now - MEDIA_RETENTION_MS) },
                },
                data: { mediaStatus: 'failed' },
            });
            const rows = await this.prisma.whatsAppMessage.findMany({
                where: {
                    mediaStatus: 'pending',
                    mediaAttempts: { lt: MEDIA_MAX_ATTEMPTS },
                    createdAt: { lt: new Date(now - MEDIA_RETRY_AFTER_MS) },
                },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: MEDIA_SWEEP_BATCH,
            });
            for (const row of rows)
                await this.fetchMedia(row.id);
        }
        catch (err) {
            this.logger.warn(`media sweep failed: ${String(err)}`);
        }
        finally {
            this.mediaSweepRunning = false;
        }
    }
    async mediaFile(messageId, variant) {
        const row = await this.prisma.whatsAppMessage.findUnique({
            where: { id: messageId },
        });
        if (!row || (!row.mediaId && !row.storagePath)) {
            throw new common_1.NotFoundException('Media not found');
        }
        if (!row.storagePath) {
            if (row.mediaStatus === 'pending') {
                void this.fetchMedia(row.id).catch(() => undefined);
            }
            throw new common_1.NotFoundException(row.mediaStatus === 'failed'
                ? 'This file could not be downloaded from WhatsApp'
                : 'This file is still being downloaded');
        }
        const filename = (0, whatsapp_util_js_1.mediaFilename)(row.type, row.filename, row.id, row.mimeType);
        if (variant === 'playback' && row.playbackPath) {
            return {
                absolutePath: (0, uploads_js_1.resolveStoredPath)(row.playbackPath),
                mimeType: 'audio/mpeg',
                filename: `${filename.replace(/\.[^.]+$/, '')}.mp3`,
            };
        }
        return {
            absolutePath: (0, uploads_js_1.resolveStoredPath)(row.storagePath),
            mimeType: (0, whatsapp_util_js_1.baseMime)(row.mimeType) ?? 'application/octet-stream',
            filename,
        };
    }
    async store(bytes, ext) {
        const relative = `${exports.WHATSAPP_SUBDIR}/${(0, crypto_1.randomUUID)()}${ext}`;
        const absolute = (0, uploads_js_1.resolveStoredPath)(relative);
        await (0, promises_1.mkdir)(path.dirname(absolute), { recursive: true });
        await (0, promises_1.writeFile)(absolute, bytes);
        return relative;
    }
    async makePlayback(bytes) {
        try {
            const { stdout, stderr, code } = await (0, attachment_stream_util_js_1.runFfmpegDetailed)(bytes, whatsapp_util_js_1.WHATSAPP_PLAYBACK_MP3_ARGS);
            if (code !== 0 || !stdout.length) {
                this.logger.warn(`playback transcode exited ${code}: ${stderr.slice(-300)}`);
                return { mp3: null, durationSec: null };
            }
            const ms = (0, phone_audio_util_js_1.parseDurationMs)(stderr);
            return {
                mp3: stdout,
                durationSec: ms > 0 ? Math.max(1, Math.round(ms / 1000)) : null,
            };
        }
        catch (err) {
            this.logger.warn(`playback transcode failed: ${String(err)}`);
            return { mp3: null, durationSec: null };
        }
    }
    async answeredPeers(companyId) {
        const rows = await this.prisma.whatsAppMessage.findMany({
            where: { companyId, direction: 'inbound' },
            select: { peerWaId: true },
            distinct: ['peerWaId'],
        });
        return rows.map((r) => r.peerWaId);
    }
    async getTimeline(companyId, cursor, limit) {
        const answered = await this.answeredPeers(companyId);
        const [account, rows, names] = await Promise.all([
            this.prisma.whatsAppAccount.findUnique({
                where: { companyId },
                select: { id: true },
            }),
            this.prisma.whatsAppMessage.findMany({
                where: {
                    companyId,
                    ...(cursor ? { id: { lt: cursor } } : {}),
                    OR: [
                        { direction: 'inbound' },
                        { direction: 'outbound', peerWaId: { notIn: answered } },
                    ],
                },
                orderBy: { id: 'desc' },
                take: limit + 1,
            }),
            this.contactNames(companyId),
        ]);
        const page = rows.slice(0, limit);
        const hasMore = rows.length > limit;
        return {
            items: page.map((row) => toItem(row, names)),
            nextCursor: hasMore ? page[page.length - 1].id : null,
            hasMore,
            connected: account !== null,
        };
    }
    async getThread(companyId, rawPeer) {
        const peer = (0, whatsapp_util_js_1.normalizeWaId)(rawPeer);
        if (!peer)
            throw new common_1.BadRequestException('peer must be a WhatsApp number');
        const [account, rows, lastInbound, names] = await Promise.all([
            this.prisma.whatsAppAccount.findUnique({
                where: { companyId },
                select: { id: true },
            }),
            this.prisma.whatsAppMessage.findMany({
                where: { companyId, peerWaId: peer },
                orderBy: [{ at: 'desc' }, { id: 'desc' }],
                take: THREAD_LIMIT,
            }),
            this.lastInbound(companyId, peer),
            this.contactNames(companyId),
        ]);
        return {
            messages: rows.reverse().map((row) => toItem(row, names)),
            peer,
            peerName: names.get(peer) ?? lastInbound?.profileName ?? null,
            windowOpenUntil: (0, whatsapp_util_js_1.windowOpenUntil)(lastInbound?.at ?? null)?.toISOString() ?? null,
            connected: account !== null,
        };
    }
    async getCounts(companyId) {
        const [unread, uncompleted] = await Promise.all([
            this.prisma.whatsAppMessage.count({
                where: { companyId, direction: 'inbound', readAt: null },
            }),
            this.prisma.whatsAppMessage.count({
                where: { companyId, direction: 'inbound', completedAt: null },
            }),
        ]);
        return { unread, uncompleted };
    }
    async getUncompletedCountsForAll() {
        const [accounts, grouped] = await Promise.all([
            this.prisma.whatsAppAccount.findMany({
                where: { company: { deletedAt: null } },
                select: { companyId: true },
            }),
            this.prisma.whatsAppMessage.groupBy({
                by: ['companyId'],
                where: {
                    direction: 'inbound',
                    completedAt: null,
                    company: { deletedAt: null },
                },
                _count: { _all: true },
            }),
        ]);
        const out = {};
        for (const a of accounts)
            out[a.companyId] = 0;
        for (const g of grouped)
            out[g.companyId] = g._count._all;
        return out;
    }
    async getUnreadItems(companyId, limit) {
        const [rows, names] = await Promise.all([
            this.prisma.whatsAppMessage.findMany({
                where: { companyId, direction: 'inbound', readAt: null },
                orderBy: [{ at: 'desc' }, { id: 'desc' }],
                take: limit,
            }),
            this.contactNames(companyId),
        ]);
        return rows.map((row) => toItem(row, names));
    }
    async setState(companyId, messageId, action) {
        const row = await this.prisma.whatsAppMessage.findFirst({
            where: { id: messageId, companyId },
            select: { id: true, direction: true },
        });
        if (!row)
            throw new common_1.NotFoundException('Message not found');
        if (row.direction === 'outbound')
            return;
        const now = new Date();
        const data = action === 'read'
            ? { readAt: now }
            : action === 'unread'
                ? { readAt: null }
                : action === 'complete'
                    ? { completedAt: now }
                    : { completedAt: null };
        await this.prisma.whatsAppMessage.update({ where: { id: row.id }, data });
    }
    async sendText(companyId, to, body, userId) {
        const peer = (0, whatsapp_util_js_1.normalizeWaId)(to);
        if (!peer)
            throw new common_1.BadRequestException('to must be a WhatsApp number');
        const text = body.trim();
        if (!text)
            throw new common_1.BadRequestException('Message is empty');
        if (text.length > 4096) {
            throw new common_1.BadRequestException('WhatsApp messages are limited to 4096 characters');
        }
        const { account, token } = await this.accounts.requireActive(companyId);
        const last = await this.assertWindowOpen(companyId, peer);
        let wamid;
        try {
            wamid = await this.graph.sendText(account.phoneNumberId, token, peer, text);
        }
        catch (err) {
            toHttpError(err);
        }
        const now = new Date();
        const row = await this.prisma.whatsAppMessage.create({
            data: {
                companyId,
                phoneNumberId: account.phoneNumberId,
                wamid,
                direction: 'outbound',
                peerWaId: peer,
                profileName: last.profileName,
                type: 'text',
                body: text,
                status: 'sent',
                sentById: userId,
                at: now,
                readAt: now,
                completedAt: now,
            },
        });
        return toItem(row, await this.contactNames(companyId));
    }
    async listTemplates(companyId) {
        const { account, token } = await this.accounts.requireActive(companyId);
        if (!account.wabaId)
            return [];
        try {
            return await this.graph.listTemplates(account.wabaId, token);
        }
        catch (err) {
            this.logger.warn(`listTemplates failed for company ${companyId}: ${String(err)}`);
            return [];
        }
    }
    async sendTemplateMessage(companyId, to, name, language, variables, userId) {
        const peer = (0, whatsapp_util_js_1.normalizeWaId)(to);
        if (!peer)
            throw new common_1.BadRequestException('to must be a WhatsApp number');
        const { account, token } = await this.accounts.requireActive(companyId);
        const known = (await this.listTemplates(companyId)).find((t) => t.name === name && t.language === language);
        const rendered = known
            ? (0, whatsapp_util_js_1.renderTemplateBody)(known.body, variables)
            : `(template: ${name})`;
        let wamid;
        try {
            wamid = await this.graph.sendTemplate(account.phoneNumberId, token, peer, name, language, (0, whatsapp_util_js_1.templateComponents)(variables));
        }
        catch (err) {
            toHttpError(err);
        }
        const now = new Date();
        const row = await this.prisma.whatsAppMessage.create({
            data: {
                companyId,
                phoneNumberId: account.phoneNumberId,
                wamid,
                direction: 'outbound',
                peerWaId: peer,
                profileName: null,
                type: 'template',
                body: rendered,
                status: 'sent',
                sentById: userId,
                at: now,
                readAt: now,
                completedAt: now,
            },
        });
        return toItem(row, await this.contactNames(companyId));
    }
    async sendVoice(companyId, to, file, userId) {
        const peer = (0, whatsapp_util_js_1.normalizeWaId)(to);
        if (!peer)
            throw new common_1.BadRequestException('to must be a WhatsApp number');
        if (!file.buffer?.length)
            throw new common_1.BadRequestException('The recording is empty');
        const { account, token } = await this.accounts.requireActive(companyId);
        const last = await this.assertWindowOpen(companyId, peer);
        let ogg;
        try {
            ogg = await (0, attachment_stream_util_js_1.runFfmpeg)(file.buffer, whatsapp_util_js_1.WHATSAPP_VOICE_ARGS);
        }
        catch (err) {
            this.logger.warn(`voice transcode failed (${file.mimetype}): ${String(err)}`);
            throw new common_1.BadRequestException('That recording could not be processed');
        }
        if (ogg.length > exports.MAX_VOICE_BYTES) {
            throw new common_1.BadRequestException('The recording is too long to send');
        }
        const playback = await this.makePlayback(ogg);
        let mediaId;
        let wamid;
        try {
            mediaId = await this.graph.uploadMedia(account.phoneNumberId, token, ogg, 'audio/ogg', 'voice-message.ogg');
            wamid = await this.graph.sendAudio(account.phoneNumberId, token, peer, mediaId);
        }
        catch (err) {
            toHttpError(err);
        }
        let storagePath = null;
        let playbackPath = null;
        try {
            storagePath = await this.store(ogg, '.ogg');
            if (playback.mp3)
                playbackPath = await this.store(playback.mp3, '.mp3');
        }
        catch (err) {
            this.logger.error(`storing sent voice note ${wamid} failed: ${String(err)}`);
        }
        const now = new Date();
        const row = await this.prisma.whatsAppMessage.create({
            data: {
                companyId,
                phoneNumberId: account.phoneNumberId,
                wamid,
                direction: 'outbound',
                peerWaId: peer,
                profileName: last.profileName,
                type: 'audio',
                mediaId,
                mimeType: 'audio/ogg',
                size: ogg.length,
                storagePath,
                playbackPath,
                mediaStatus: storagePath ? 'ready' : 'pending',
                isVoice: true,
                durationSec: playback.durationSec,
                status: 'sent',
                sentById: userId,
                at: now,
                readAt: now,
                completedAt: now,
            },
        });
        return toItem(row, await this.contactNames(companyId));
    }
    lastInbound(companyId, peer) {
        return this.prisma.whatsAppMessage.findFirst({
            where: { companyId, peerWaId: peer, direction: 'inbound' },
            orderBy: { at: 'desc' },
            select: { at: true, profileName: true },
        });
    }
    async assertWindowOpen(companyId, peer) {
        const last = await this.lastInbound(companyId, peer);
        if (!(0, whatsapp_util_js_1.isWindowOpen)(last?.at ?? null, new Date())) {
            throw new common_1.BadRequestException(last
                ? 'The 24-hour reply window is closed. WhatsApp only allows an approved template until the customer writes again.'
                : 'This customer has not messaged this number yet. WhatsApp only allows an approved template as the first message.');
        }
        return { profileName: last?.profileName ?? null };
    }
    async contactNames(companyId) {
        try {
            const rows = await this.prisma.contact.findMany({
                where: { companyId, deletedAt: null, phoneE164: { not: null } },
                select: { phoneE164: true, name: true },
                orderBy: { name: 'asc' },
            });
            return new Map(rows.map((r) => [r.phoneE164.replace(/\D/g, ''), r.name]));
        }
        catch (err) {
            this.logger.warn(`contactNames(${companyId}) failed: ${String(err)}`);
            return new Map();
        }
    }
};
exports.WhatsAppMessagesService = WhatsAppMessagesService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_5_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], WhatsAppMessagesService.prototype, "retryPendingMedia", null);
exports.WhatsAppMessagesService = WhatsAppMessagesService = WhatsAppMessagesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        whatsapp_graph_service_js_1.WhatsAppGraphService,
        whatsapp_account_service_js_1.WhatsAppAccountService])
], WhatsAppMessagesService);
//# sourceMappingURL=whatsapp-messages.service.js.map