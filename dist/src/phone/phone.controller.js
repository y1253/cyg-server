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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const phone_provisioning_service_js_1 = require("./phone-provisioning.service.js");
const attach_number_dto_js_1 = require("./dto/attach-number.dto.js");
const phone_events_service_js_1 = require("./phone-events.service.js");
const phone_config_js_1 = require("./phone.config.js");
const phone_timeline_service_js_1 = require("./phone-timeline.service.js");
const phone_dialer_service_js_1 = require("./phone-dialer.service.js");
const message_state_service_js_1 = require("../communications/message-state.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const send_sms_dto_js_1 = require("./dto/send-sms.dto.js");
const start_call_dto_js_1 = require("./dto/start-call.dto.js");
const phone_item_state_dto_js_1 = require("./dto/phone-item-state.dto.js");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const recording_token_util_js_1 = require("./recording-token.util.js");
const company_phone_access_util_js_1 = require("./company-phone-access.util.js");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const phone_audio_service_js_1 = require("../phone-audio/phone-audio.service.js");
const phone_settings_service_js_1 = require("../phone-settings/phone-settings.service.js");
const rxjs_1 = require("rxjs");
const SSE_HEARTBEAT_MS = 25_000;
let PhoneController = class PhoneController {
    provisioning;
    events;
    timeline;
    dialer;
    state;
    signalwire;
    prisma;
    audio;
    settings;
    constructor(provisioning, events, timeline, dialer, state, signalwire, prisma, audio, settings) {
        this.provisioning = provisioning;
        this.events = events;
        this.timeline = timeline;
        this.dialer = dialer;
        this.state = state;
        this.signalwire = signalwire;
        this.prisma = prisma;
        this.audio = audio;
        this.settings = settings;
    }
    getSipCredentials() {
        const creds = (0, phone_config_js_1.sipCredentials)(process.env);
        if (!creds) {
            throw new common_1.ServiceUnavailableException('Softphone is not configured on the server');
        }
        return creds;
    }
    getPendingCall(req) {
        return this.events.takePending(req.user.userId);
    }
    streamEvents(token, req) {
        const userId = (0, attachment_stream_util_js_1.verifyQueryTokenUser)(token);
        const subject = new rxjs_1.Subject();
        const clientId = `${userId}-${Date.now()}-${Math.random()}`;
        this.events.addClient(clientId, userId, subject);
        const closed = new rxjs_1.Subject();
        req.on('close', () => {
            this.events.removeClient(clientId);
            closed.next();
            closed.complete();
        });
        const heartbeat = (0, rxjs_1.interval)(SSE_HEARTBEAT_MS).pipe((0, rxjs_1.map)(() => ({ data: JSON.stringify({ type: 'ping' }) })));
        return (0, rxjs_1.merge)(subject.asObservable(), heartbeat).pipe((0, rxjs_1.takeUntil)(closed));
    }
    async getRecording(sid, token, range, res) {
        (0, recording_token_util_js_1.assertRecordingToken)(token, sid);
        const { buffer, contentType } = await this.signalwire.fetchRecordingMedia(sid);
        (0, attachment_stream_util_js_1.streamAttachment)(res, buffer, contentType, `call-${sid}.mp3`, 'inline', range);
    }
    async getAudio(id, token, range, res) {
        (0, attachment_stream_util_js_1.verifyQueryTokenUser)(token);
        const file = await this.audio.streamable(id);
        await (0, attachment_stream_util_js_1.streamAttachmentFile)(res, file.absolutePath, file.mimeType, file.filename, 'inline', range);
    }
    searchAvailable(country, areaCode) {
        return this.provisioning.searchAvailable(country, areaCode);
    }
    getNumber(companyId) {
        return this.provisioning.getActiveNumber(companyId);
    }
    attachNumber(companyId, dto) {
        return this.provisioning.attachNumber(companyId, dto.phoneNumber, dto.region);
    }
    releaseNumber(companyId) {
        return this.provisioning.releaseNumber(companyId);
    }
    getTimeline(companyId, before, limit) {
        const parsed = Number.parseInt(limit ?? '', 10);
        return this.timeline.getTimeline(companyId, before, Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25);
    }
    hold(companyId, sid, req) {
        return this.setRecordingPaused(companyId, sid, req.user.userId, true);
    }
    resume(companyId, sid, req) {
        return this.setRecordingPaused(companyId, sid, req.user.userId, false);
    }
    async holdAudio(companyId) {
        const effective = await this.settings.effectiveFor(companyId);
        const track = await this.audio.resolve(effective.holdAudioId);
        return track ? { audioId: track.id, name: track.name } : { audioId: null };
    }
    async getRinging(companyId, req) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
            select: {
                businessName: true,
                assignments: { select: { userId: true } },
            },
        });
        if (!company)
            return null;
        await (0, company_phone_access_util_js_1.assertMayUseCompanyPhone)(this.prisma, company.assignments, req.user.userId, company.businessName, 'answer a call');
        return this.events.getRinging(companyId);
    }
    getCounts(companyId) {
        return this.timeline.getCounts(companyId);
    }
    getSmsThread(companyId, peer) {
        return this.timeline.getSmsThread(companyId, peer ?? '');
    }
    sendSms(companyId, dto) {
        return this.timeline.sendSms(companyId, dto.to, dto.body);
    }
    startCall(companyId, dto, req) {
        return this.dialer.startCall(companyId, dto.to, req.user.userId);
    }
    getCallRecordings(companyId, sid) {
        return this.timeline.getCallRecordings(companyId, sid);
    }
    async markRead(companyId, dto) {
        await this.state.markChatRead(companyId, dto.itemId);
    }
    async markUnread(companyId, dto) {
        await this.state.markChatUnread(companyId, dto.itemId);
    }
    async markComplete(companyId, dto) {
        await this.state.markComplete(companyId, dto.itemId);
    }
    async markUncomplete(companyId, dto) {
        await this.state.markUncomplete(companyId, dto.itemId);
    }
    async setRecordingPaused(companyId, callSid, userId, paused) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
            select: { businessName: true, assignments: { select: { userId: true } } },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        await (0, company_phone_access_util_js_1.assertMayUseCompanyPhone)(this.prisma, company.assignments, userId, company.businessName, paused ? 'hold a call' : 'resume a call');
        await this.timeline.assertCallBelongsTo(companyId, callSid);
        try {
            const recordings = await this.signalwire.listRecordings({ callSid });
            const live = recordings.find((r) => r.status === 'in-progress' || r.status === 'paused');
            if (!live)
                return { recordingPaused: false };
            const ok = await this.signalwire.updateRecording(callSid, live.sid, paused ? 'paused' : 'in-progress');
            return { recordingPaused: ok && paused };
        }
        catch {
            return { recordingPaused: false };
        }
    }
};
exports.PhoneController = PhoneController;
__decorate([
    (0, common_1.Get)('sip-credentials'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getSipCredentials", null);
__decorate([
    (0, common_1.Get)('pending-call'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getPendingCall", null);
__decorate([
    (0, common_1.Sse)('events'),
    __param(0, (0, common_1.Query)('token')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", rxjs_1.Observable)
], PhoneController.prototype, "streamEvents", null);
__decorate([
    (0, common_1.Get)('recordings/:sid'),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Headers)('range')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "getRecording", null);
__decorate([
    (0, common_1.Get)('audio/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Headers)('range')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, Object]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "getAudio", null);
__decorate([
    (0, common_1.Get)('available'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Query)('country')),
    __param(1, (0, common_1.Query)('areaCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "searchAvailable", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/number'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getNumber", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/number'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, attach_number_dto_js_1.AttachNumberDto]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "attachNumber", null);
__decorate([
    (0, common_1.Delete)('companies/:companyId/number'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "releaseNumber", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/timeline'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('before')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getTimeline", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/calls/:sid/hold'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('sid')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, Object]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "hold", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/calls/:sid/resume'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('sid')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, Object]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "resume", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/hold-audio'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "holdAudio", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/ringing'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "getRinging", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/counts'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getCounts", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/sms-thread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('peer')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getSmsThread", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/sms'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, send_sms_dto_js_1.SendSmsDto]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "sendSms", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/calls'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, start_call_dto_js_1.StartCallDto, Object]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "startCall", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/calls/:sid/recordings'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getCallRecordings", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/items/read'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, phone_item_state_dto_js_1.PhoneItemStateDto]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "markRead", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/items/unread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, phone_item_state_dto_js_1.PhoneItemStateDto]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "markUnread", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/items/complete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, phone_item_state_dto_js_1.PhoneItemStateDto]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "markComplete", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/items/uncomplete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, phone_item_state_dto_js_1.PhoneItemStateDto]),
    __metadata("design:returntype", Promise)
], PhoneController.prototype, "markUncomplete", null);
exports.PhoneController = PhoneController = __decorate([
    (0, common_1.Controller)('phone'),
    __metadata("design:paramtypes", [phone_provisioning_service_js_1.PhoneProvisioningService,
        phone_events_service_js_1.PhoneEventsService,
        phone_timeline_service_js_1.PhoneTimelineService,
        phone_dialer_service_js_1.PhoneDialerService,
        message_state_service_js_1.MessageStateService,
        signalwire_service_js_1.SignalWireService,
        prisma_service_js_1.PrismaService,
        phone_audio_service_js_1.PhoneAudioService,
        phone_settings_service_js_1.PhoneSettingsService])
], PhoneController);
//# sourceMappingURL=phone.controller.js.map