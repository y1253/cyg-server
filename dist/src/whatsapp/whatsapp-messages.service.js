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
exports.WhatsAppMessagesService = exports.WHATSAPP_OUTBOX_SUBDIR = exports.WHATSAPP_SUBDIR = void 0;
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
const ai_service_js_1 = require("../ai/ai.service.js");
const call_summary_util_js_1 = require("../phone/call-summary.util.js");
const whatsapp_util_js_1 = require("./whatsapp.util.js");
const whatsapp_template_status_util_js_1 = require("./whatsapp-template-status.util.js");
const whatsapp_graph_service_js_1 = require("./whatsapp-graph.service.js");
const whatsapp_util_js_2 = require("./whatsapp.util.js");
exports.WHATSAPP_SUBDIR = 'whatsapp';
exports.WHATSAPP_OUTBOX_SUBDIR = 'whatsapp-outbox';
const THREAD_LIMIT = 200;
const MEDIA_MAX_ATTEMPTS = 3;
const MEDIA_RETRY_AFTER_MS = 2 * 60_000;
const MEDIA_RETENTION_MS = 29 * 24 * 60 * 60_000;
const MEDIA_SWEEP_BATCH = 20;
function extensionOfName(filename) {
    const dot = filename.lastIndexOf('.');
    const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
    return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}
async function discardStagedUpload(absolutePath) {
    await (0, promises_1.rm)(absolutePath, { force: true }).catch(() => undefined);
}
function localIdsByWamid(rows) {
    return new Map(rows.map((r) => [r.wamid, r.id]));
}
function toItem(row, names, localIds) {
    const outbound = row.direction === 'outbound';
    return {
        id: (0, whatsapp_util_js_2.whatsappItemId)(row.id),
        messageId: row.id,
        kind: 'whatsapp',
        direction: outbound ? 'outbound' : 'inbound',
        peer: row.peerWaId,
        peerName: names.get(row.peerWaId) ?? row.profileName ?? null,
        type: row.type,
        body: row.body,
        isVoice: row.isVoice,
        durationSec: row.durationSec,
        ...(row.transcript ? { transcript: row.transcript } : {}),
        ...(row.transcriptStatus
            ? { transcriptStatus: row.transcriptStatus }
            : {}),
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
        replyToMessageId: row.replyToWamid
            ? (localIds?.get(row.replyToWamid) ?? null)
            : null,
    };
}
function toHttpError(err) {
    if (err instanceof whatsapp_graph_service_js_1.WhatsAppGraphError) {
        const message = (0, whatsapp_util_js_2.friendlyGraphMessage)(err.code, err.message);
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
    ai;
    logger = new common_1.Logger(WhatsAppMessagesService_1.name);
    mediaInFlight = new Set();
    mediaSweepRunning = false;
    constructor(prisma, graph, accounts, ai) {
        this.prisma = prisma;
        this.graph = graph;
        this.accounts = accounts;
        this.ai = ai;
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
                            replyToWamid: m.replyToWamid,
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
        const next = (0, whatsapp_util_js_2.nextDeliveryStatus)(row.status, s.status);
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
            const storagePath = await this.store(bytes, (0, whatsapp_util_js_2.extensionForMime)(mime));
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
    async transcribeVoice(companyId, messageId) {
        const row = await this.prisma.whatsAppMessage.findFirst({
            where: { id: messageId, companyId },
            select: {
                id: true,
                isVoice: true,
                playbackPath: true,
                transcript: true,
                transcriptStatus: true,
            },
        });
        if (!row)
            throw new common_1.NotFoundException('Message not found');
        if (row.transcriptStatus) {
            return { transcript: row.transcript, status: row.transcriptStatus };
        }
        if (!row.isVoice) {
            throw new common_1.BadRequestException('That message is not a voice note.');
        }
        if (!row.playbackPath) {
            throw new common_1.BadRequestException('That voice note has not finished downloading yet.');
        }
        const audio = await (0, promises_1.readFile)((0, uploads_js_1.resolveStoredPath)(row.playbackPath));
        const text = await this.ai.transcribeAudio(audio, `voice-${row.id}.mp3`, 'audio/mpeg');
        const usable = text.trim().length >= call_summary_util_js_1.MIN_TRANSCRIPT_CHARS;
        const status = usable ? 'ready' : 'skipped';
        await this.prisma.whatsAppMessage.update({
            where: { id: row.id },
            data: { transcript: usable ? text.trim() : null, transcriptStatus: status },
        });
        return { transcript: usable ? text.trim() : null, status };
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
        const filename = (0, whatsapp_util_js_2.mediaFilename)(row.type, row.filename, row.id, row.mimeType);
        if (variant === 'playback' && row.playbackPath) {
            return {
                absolutePath: (0, uploads_js_1.resolveStoredPath)(row.playbackPath),
                mimeType: 'audio/mpeg',
                filename: `${filename.replace(/\.[^.]+$/, '')}.mp3`,
            };
        }
        return {
            absolutePath: (0, uploads_js_1.resolveStoredPath)(row.storagePath),
            mimeType: (0, whatsapp_util_js_2.baseMime)(row.mimeType) ?? 'application/octet-stream',
            filename,
        };
    }
    async storeFile(sourcePath, ext) {
        const relative = `${exports.WHATSAPP_SUBDIR}/${(0, crypto_1.randomUUID)()}${ext}`;
        const absolute = (0, uploads_js_1.resolveStoredPath)(relative);
        await (0, promises_1.mkdir)(path.dirname(absolute), { recursive: true });
        await (0, promises_1.rename)(sourcePath, absolute);
        return relative;
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
            const { stdout, stderr, code } = await (0, attachment_stream_util_js_1.runFfmpegDetailed)(bytes, whatsapp_util_js_2.WHATSAPP_PLAYBACK_MP3_ARGS);
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
        const localIds = localIdsByWamid(page);
        return {
            items: page.map((row) => toItem(row, names, localIds)),
            nextCursor: hasMore ? page[page.length - 1].id : null,
            hasMore,
            connected: account !== null,
        };
    }
    async getThread(companyId, rawPeer) {
        const peer = (0, whatsapp_util_js_2.normalizeWaId)(rawPeer);
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
        const threadLocalIds = localIdsByWamid(rows);
        return {
            messages: rows.reverse().map((row) => toItem(row, names, threadLocalIds)),
            peer,
            peerName: names.get(peer) ?? lastInbound?.profileName ?? null,
            windowOpenUntil: (0, whatsapp_util_js_2.windowOpenUntil)(lastInbound?.at ?? null)?.toISOString() ?? null,
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
    async completeUntil(companyId, messageId) {
        const anchor = await this.prisma.whatsAppMessage.findFirst({
            where: { id: messageId, companyId },
            select: { id: true, at: true, peerWaId: true },
        });
        if (!anchor)
            throw new common_1.NotFoundException('Message not found');
        const now = new Date();
        const { count } = await this.prisma.whatsAppMessage.updateMany({
            where: {
                companyId,
                peerWaId: anchor.peerWaId,
                direction: 'inbound',
                completedAt: null,
                OR: [
                    { at: { lt: anchor.at } },
                    { at: anchor.at, id: { lte: anchor.id } },
                ],
            },
            data: { completedAt: now },
        });
        return { completed: count };
    }
    async readUntil(companyId, messageId) {
        const anchor = await this.prisma.whatsAppMessage.findFirst({
            where: { id: messageId, companyId },
            select: { id: true, at: true, peerWaId: true },
        });
        if (!anchor)
            throw new common_1.NotFoundException('Message not found');
        const now = new Date();
        const { count } = await this.prisma.whatsAppMessage.updateMany({
            where: {
                companyId,
                peerWaId: anchor.peerWaId,
                direction: 'inbound',
                readAt: null,
                OR: [
                    { at: { lt: anchor.at } },
                    { at: anchor.at, id: { lte: anchor.id } },
                ],
            },
            data: { readAt: now },
        });
        return { completed: count };
    }
    async sendText(companyId, to, body, userId, replyToMessageId) {
        const peer = (0, whatsapp_util_js_2.normalizeWaId)(to);
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
        const replyToWamid = await this.replyTarget(companyId, peer, replyToMessageId);
        let wamid;
        try {
            wamid = await this.graph.sendText(account.phoneNumberId, token, peer, text, replyToWamid);
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
                replyToWamid,
            },
        });
        return toItem(row, await this.contactNames(companyId));
    }
    async replyTarget(companyId, peer, messageId) {
        if (!messageId)
            return null;
        const row = await this.prisma.whatsAppMessage.findFirst({
            where: { id: messageId, companyId, peerWaId: peer },
            select: { wamid: true },
        });
        if (!row) {
            this.logger.warn(`reply target ${messageId} not found for company ${companyId} peer ${peer}; sending unquoted`);
            return null;
        }
        return row.wamid;
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
    async createTemplate(companyId, input, submittedById = null) {
        const { account, token } = await this.accounts.requireActive(companyId);
        if (!account.wabaId) {
            throw new common_1.BadRequestException('This company has no WhatsApp Business account, so a template cannot be created.');
        }
        const name = input.name.trim().toLowerCase();
        if (!(0, whatsapp_util_js_2.isValidTemplateName)(name)) {
            throw new common_1.BadRequestException('A template name may use only lowercase letters, numbers and underscores.');
        }
        if (!(0, whatsapp_util_js_2.isValidTemplateLanguage)(input.language)) {
            throw new common_1.BadRequestException('Language must be a locale like en_US or fr, not en-US.');
        }
        if (!whatsapp_util_js_2.TEMPLATE_CATEGORIES.includes(input.category)) {
            throw new common_1.BadRequestException(`Category must be one of ${whatsapp_util_js_2.TEMPLATE_CATEGORIES.join(', ')}.`);
        }
        const body = input.body.trim();
        if (!body)
            throw new common_1.BadRequestException('A template needs a body.');
        let created;
        try {
            created = await this.graph.createTemplate(account.wabaId, token, {
                name,
                language: input.language,
                category: input.category,
                components: (0, whatsapp_util_js_2.buildTemplateComponents)(body, input.examples ?? []),
            });
        }
        catch (err) {
            toHttpError(err);
        }
        this.logger.log(`company ${companyId} submitted WhatsApp template ${name} (${input.language}) -> ${created.status}`);
        await this.recordSubmission(companyId, submittedById, {
            metaTemplateId: created.id,
            name,
            language: input.language,
            category: input.category,
            body,
            status: created.status,
            examples: input.examples ?? [],
        });
        return {
            id: created.id,
            name,
            language: input.language,
            category: input.category,
            body,
            variableCount: (0, whatsapp_util_js_2.countTemplateVariables)(body),
            status: created.status,
            rejectedReason: null,
        };
    }
    async recordSubmission(companyId, submittedById, input) {
        try {
            await this.prisma.whatsAppTemplateSubmission.upsert({
                where: {
                    companyId_name_language: {
                        companyId,
                        name: input.name,
                        language: input.language,
                    },
                },
                create: {
                    companyId,
                    submittedById,
                    ...input,
                    examples: JSON.stringify(input.examples),
                    rejectedReason: null,
                },
                update: {
                    metaTemplateId: input.metaTemplateId,
                    category: input.category,
                    body: input.body,
                    examples: JSON.stringify(input.examples),
                    status: input.status,
                    rejectedReason: null,
                    dismissedAt: null,
                    submittedById,
                },
            });
        }
        catch (err) {
            this.logger.error(`could not record template submission ${input.name} (${input.language}) ` +
                `for company ${companyId}: ${String(err)}`);
        }
    }
    async listSubmissions(companyId) {
        const rows = await this.prisma.whatsAppTemplateSubmission.findMany({
            where: { companyId, dismissedAt: null },
            orderBy: { id: 'desc' },
            take: 20,
        });
        if (rows.length === 0)
            return [];
        const unsettled = rows.some((r) => !(0, whatsapp_util_js_1.isSettledTemplateStatus)(r.status));
        if (!unsettled)
            return rows.map((row) => (0, whatsapp_util_js_1.toSubmissionDto)(row));
        const live = this.listTemplates
            ? await this.listTemplates(companyId)
            : [];
        const narrowed = live.flatMap((t) => {
            const status = (0, whatsapp_util_js_1.asTemplateStatus)(t.status);
            return status
                ? [{
                        id: t.id,
                        name: t.name,
                        language: t.language,
                        status,
                        rejectedReason: t.rejectedReason,
                    }]
                : [];
        });
        const patches = (0, whatsapp_template_status_util_js_1.reconcileSubmissions)(rows, narrowed);
        for (const patch of patches) {
            await this.prisma.whatsAppTemplateSubmission
                .update({
                where: { id: patch.id },
                data: {
                    status: patch.status,
                    rejectedReason: patch.rejectedReason,
                },
            })
                .catch(() => undefined);
        }
        const byId = new Map(patches.map((p) => [p.id, p]));
        return rows.map((row) => (0, whatsapp_util_js_1.toSubmissionDto)(row, byId.get(row.id)));
    }
    async dismissSubmission(companyId, id) {
        const { count } = await this.prisma.whatsAppTemplateSubmission.updateMany({
            where: { id, companyId, dismissedAt: null },
            data: { dismissedAt: new Date() },
        });
        if (count === 0)
            throw new common_1.NotFoundException('Submission not found');
    }
    async generateTemplate(companyId, description) {
        await this.accounts.requireActive(companyId);
        const { raw } = await this.ai.generateTemplate(description.trim());
        const parsed = (0, whatsapp_util_js_1.parseGeneratedTemplate)(raw);
        const normalized = (0, whatsapp_util_js_1.normalizeTemplatePlaceholders)(parsed.body.trim().slice(0, 1024));
        const taken = (await this.listTemplates(companyId)).map((t) => t.name);
        return {
            name: (0, whatsapp_util_js_1.suggestTemplateName)(description, taken),
            category: parsed.category ?? whatsapp_util_js_2.TEMPLATE_CATEGORIES[0],
            body: normalized.body,
            examples: parsed.examples.slice(0, normalized.count),
            variableCount: normalized.count,
        };
    }
    async sendTemplateMessage(companyId, to, name, language, variables, userId) {
        const peer = (0, whatsapp_util_js_2.normalizeWaId)(to);
        if (!peer)
            throw new common_1.BadRequestException('to must be a WhatsApp number');
        const { account, token } = await this.accounts.requireActive(companyId);
        const known = (await this.listTemplates(companyId)).find((t) => t.name === name && t.language === language);
        if (known && !(0, whatsapp_util_js_2.isSendableTemplate)(known.status)) {
            throw new common_1.BadRequestException(`The template "${name}" is ${known.status.toLowerCase()}, not approved, so WhatsApp will not send it.`);
        }
        const rendered = known?.body != null
            ? (0, whatsapp_util_js_2.renderTemplateBody)(known.body, variables)
            : `(template: ${name})`;
        let wamid;
        try {
            wamid = await this.graph.sendTemplate(account.phoneNumberId, token, peer, name, language, (0, whatsapp_util_js_2.templateComponents)(variables));
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
    async sendMedia(companyId, to, file, userId, opts = {}) {
        try {
            const peer = (0, whatsapp_util_js_2.normalizeWaId)(to);
            if (!peer)
                throw new common_1.BadRequestException('to must be a WhatsApp number');
            if (!file.size)
                throw new common_1.BadRequestException('That file is empty');
            const kind = (0, whatsapp_util_js_2.whatsappMediaKind)(file.mimetype, file.originalname);
            const max = whatsapp_util_js_2.WHATSAPP_MEDIA_MAX_BYTES[kind];
            if (file.size > max) {
                throw new common_1.BadRequestException(`WhatsApp accepts ${kind === 'document' ? 'files' : kind + ' files'} up to ${Math.round(max / (1024 * 1024))} MB`);
            }
            const caption = (opts.caption ?? '').trim();
            if (caption.length > whatsapp_util_js_2.WHATSAPP_MAX_CAPTION) {
                throw new common_1.BadRequestException(`A caption is limited to ${whatsapp_util_js_2.WHATSAPP_MAX_CAPTION} characters`);
            }
            const { account, token } = await this.accounts.requireActive(companyId);
            const last = await this.assertWindowOpen(companyId, peer);
            const replyToWamid = await this.replyTarget(companyId, peer, opts.replyToMessageId);
            const mimeType = (0, whatsapp_util_js_2.baseMime)(file.mimetype) ?? 'application/octet-stream';
            let mediaId;
            let wamid;
            try {
                mediaId = await this.graph.uploadMediaFromFile(account.phoneNumberId, token, file.path, mimeType, file.originalname);
                wamid = await this.graph.sendMedia(account.phoneNumberId, token, peer, kind, mediaId, { caption, filename: file.originalname, replyToWamid });
            }
            catch (err) {
                toHttpError(err);
            }
            let storagePath = null;
            let playbackPath = null;
            let durationSec = null;
            try {
                storagePath = await this.storeFile(file.path, (0, whatsapp_util_js_2.extensionForMime)(mimeType) || extensionOfName(file.originalname));
                if (kind === 'audio' && storagePath) {
                    const playback = await this.makePlayback(await (0, promises_1.readFile)((0, uploads_js_1.resolveStoredPath)(storagePath)));
                    if (playback.mp3)
                        playbackPath = await this.store(playback.mp3, '.mp3');
                    durationSec = playback.durationSec;
                }
            }
            catch (err) {
                this.logger.error(`storing sent file ${wamid} failed: ${String(err)}`);
            }
            const now = new Date();
            const row = await this.prisma.whatsAppMessage.create({
                data: {
                    companyId,
                    phoneNumberId: account.phoneNumberId,
                    wamid,
                    replyToWamid,
                    direction: 'outbound',
                    peerWaId: peer,
                    profileName: last.profileName,
                    type: kind,
                    body: caption || null,
                    mediaId,
                    mimeType,
                    filename: file.originalname,
                    size: file.size,
                    storagePath,
                    playbackPath,
                    mediaStatus: storagePath ? 'ready' : 'pending',
                    isVoice: false,
                    durationSec,
                    status: 'sent',
                    sentById: userId,
                    at: now,
                    readAt: now,
                    completedAt: now,
                },
            });
            return toItem(row, await this.contactNames(companyId));
        }
        finally {
            await discardStagedUpload(file.path);
        }
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
        if (!(0, whatsapp_util_js_2.isWindowOpen)(last?.at ?? null, new Date())) {
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
        whatsapp_account_service_js_1.WhatsAppAccountService,
        ai_service_js_1.AiService])
], WhatsAppMessagesService);
//# sourceMappingURL=whatsapp-messages.service.js.map