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
var WhatsAppProvisioningService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppProvisioningService = exports.NO_SUPPORT_NUMBER = exports.CODE_TIMEOUT_MS = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const crypto_1 = require("crypto");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const company_target_util_js_1 = require("../companies/company-target.util.js");
const crypto_util_js_1 = require("../communications/crypto.util.js");
const phone_events_service_js_1 = require("../phone/phone-events.service.js");
const signalwire_service_js_1 = require("../phone/signalwire.service.js");
const whatsapp_account_service_js_1 = require("./whatsapp-account.service.js");
const whatsapp_graph_service_js_1 = require("./whatsapp-graph.service.js");
const whatsapp_util_js_1 = require("./whatsapp.util.js");
exports.CODE_TIMEOUT_MS = 15 * 60_000;
const SMS_LOOKBACK_MS = 15_000;
const VERIFYING_STALE_MS = 5 * 60_000;
exports.NO_SUPPORT_NUMBER = 'NO_SUPPORT_NUMBER';
let WhatsAppProvisioningService = WhatsAppProvisioningService_1 = class WhatsAppProvisioningService {
    prisma;
    graph;
    accounts;
    events;
    signalwire;
    logger = new common_1.Logger(WhatsAppProvisioningService_1.name);
    subscription = null;
    sweeping = false;
    constructor(prisma, graph, accounts, events, signalwire) {
        this.prisma = prisma;
        this.graph = graph;
        this.accounts = accounts;
        this.events = events;
        this.signalwire = signalwire;
    }
    onModuleInit() {
        this.subscription = this.events.smsReceived$.subscribe((sms) => {
            void this.onSms(sms).catch((err) => this.logger.warn(`WhatsApp code check failed: ${String(err)}`));
        });
    }
    onModuleDestroy() {
        this.subscription?.unsubscribe();
    }
    async generate(companyId, userId) {
        await (0, company_target_util_js_1.assertRealCompany)(this.prisma, companyId, whatsapp_account_service_js_1.INTERNAL_MESSAGE);
        const cfg = (0, whatsapp_util_js_1.whatsappConfig)(process.env);
        const missing = [
            cfg.firmToken ? null : 'WHATSAPP_TOKEN',
            cfg.firmWabaId ? null : 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        ].filter((key) => key !== null);
        if (missing.length) {
            throw new common_1.ServiceUnavailableException(`WhatsApp numbers cannot be generated until ${missing.join(' and ')} is set on the server`);
        }
        const token = cfg.firmToken;
        const wabaId = cfg.firmWabaId;
        this.accounts.encryptionKey();
        const support = await this.prisma.supportNumber.findFirst({
            where: { companyId, releasedAt: null },
            select: { phoneNumber: true },
        });
        if (!support) {
            throw new common_1.ConflictException({
                statusCode: 409,
                code: exports.NO_SUPPORT_NUMBER,
                message: 'This company has no support number yet. Connect one, then generate WhatsApp.',
            });
        }
        const parts = (0, whatsapp_util_js_1.splitNanpNumber)(support.phoneNumber);
        if (!parts) {
            throw new common_1.BadRequestException(`The support number ${support.phoneNumber} is not a Canadian or US number, so it cannot be added to WhatsApp`);
        }
        const existing = await this.prisma.whatsAppAccount.findUnique({
            where: { companyId },
        });
        if (existing &&
            existing.setupStatus !== 'FAILED' &&
            existing.setupStatus !== 'PENDING_CODE') {
            throw new common_1.ConflictException(existing.setupStatus === 'CONNECTED'
                ? 'This company already has a WhatsApp number'
                : 'WhatsApp is already finishing setup for this company');
        }
        const company = await this.prisma.company.findUnique({
            where: { id: companyId },
            select: { businessName: true },
        });
        const verifiedName = (0, whatsapp_util_js_1.toDisplayName)(company?.businessName ?? '');
        if (!verifiedName) {
            throw new common_1.BadRequestException('The company needs a business name before it can have a WhatsApp number');
        }
        let phone;
        try {
            phone = await this.addOrFind(wabaId, parts, verifiedName, token);
        }
        catch (err) {
            (0, whatsapp_account_service_js_1.toHttpError)(err);
        }
        await this.accounts.assertNumberFree(phone.id, companyId);
        const base = {
            wabaId,
            phoneNumberId: phone.id,
            displayPhoneNumber: phone.displayPhoneNumber,
            verifiedName: phone.verifiedName ?? verifiedName,
            accessToken: null,
            origin: 'GENERATED',
            setupError: null,
            connectedById: userId,
        };
        if (phone.status === 'CONNECTED') {
            const row = await this.upsert(companyId, {
                ...base,
                setupStatus: 'CONNECTED',
                codeRequestedAt: null,
                connectedAt: new Date(),
            });
            await this.subscribe(wabaId, token);
            return (0, whatsapp_account_service_js_1.toView)(row);
        }
        if (phone.codeVerificationStatus === 'VERIFIED') {
            const row = await this.upsert(companyId, {
                ...base,
                setupStatus: 'PENDING_CODE',
                codeRequestedAt: new Date(),
            });
            return this.complete(row, null);
        }
        try {
            await this.graph.requestCode(phone.id, token);
        }
        catch (err) {
            if (err instanceof whatsapp_graph_service_js_1.WhatsAppGraphError && err.code === 136024) {
                const row = await this.upsert(companyId, {
                    ...base,
                    setupStatus: 'PENDING_CODE',
                    codeRequestedAt: new Date(),
                });
                return this.complete(row, null);
            }
            (0, whatsapp_account_service_js_1.toHttpError)(err);
        }
        const row = await this.upsert(companyId, {
            ...base,
            setupStatus: 'PENDING_CODE',
            codeRequestedAt: new Date(),
            registrationPin: null,
        });
        this.logger.log(`company ${companyId} generating WhatsApp on ${support.phoneNumber} (phone ${phone.id}) by user ${userId} — waiting for the code`);
        return (0, whatsapp_account_service_js_1.toView)(row);
    }
    async onSms(sms) {
        const code = (0, whatsapp_util_js_1.extractWhatsAppCode)(sms.body);
        if (!code || !sms.to)
            return;
        const support = await this.prisma.supportNumber.findFirst({
            where: { phoneNumber: sms.to, releasedAt: null },
            select: { companyId: true },
        });
        if (!support)
            return;
        const account = await this.prisma.whatsAppAccount.findUnique({
            where: { companyId: support.companyId },
        });
        if (account?.setupStatus !== 'PENDING_CODE')
            return;
        this.logger.log(`WhatsApp code arrived by webhook for company ${support.companyId}`);
        await this.complete(account, code);
    }
    async complete(account, code) {
        const claimed = await this.prisma.whatsAppAccount.updateMany({
            where: { id: account.id, setupStatus: 'PENDING_CODE' },
            data: { setupStatus: 'VERIFYING' },
        });
        if (claimed.count === 0) {
            const current = await this.prisma.whatsAppAccount.findUnique({
                where: { id: account.id },
            });
            return (0, whatsapp_account_service_js_1.toView)(current ?? account);
        }
        const cfg = (0, whatsapp_util_js_1.whatsappConfig)(process.env);
        try {
            if (!cfg.firmToken) {
                throw new whatsapp_graph_service_js_1.WhatsAppGraphError('WHATSAPP_TOKEN is no longer set on the server', 0);
            }
            if (code) {
                await this.graph.verifyCode(account.phoneNumberId, code, cfg.firmToken);
            }
            const pin = (0, crypto_1.randomInt)(0, 1_000_000).toString().padStart(6, '0');
            await this.graph.registerNumber(account.phoneNumberId, pin, cfg.firmToken);
            const registrationPin = (0, crypto_util_js_1.encrypt)(pin, this.accounts.encryptionKey());
            if (cfg.firmWabaId)
                await this.subscribe(cfg.firmWabaId, cfg.firmToken);
            const row = await this.prisma.whatsAppAccount.update({
                where: { id: account.id },
                data: {
                    setupStatus: 'CONNECTED',
                    setupError: null,
                    registrationPin,
                    connectedAt: new Date(),
                },
            });
            this.logger.log(`company ${account.companyId} WhatsApp ${account.displayPhoneNumber} is connected`);
            return (0, whatsapp_account_service_js_1.toView)(row);
        }
        catch (err) {
            const message = err instanceof whatsapp_graph_service_js_1.WhatsAppGraphError
                ? (0, whatsapp_util_js_1.friendlyGraphMessage)(err.code, err.message)
                : 'WhatsApp setup failed unexpectedly. Try again.';
            this.logger.warn(`WhatsApp setup for company ${account.companyId} failed: ${err instanceof Error ? err.message : String(err)}`);
            const row = await this.prisma.whatsAppAccount.update({
                where: { id: account.id },
                data: { setupStatus: 'FAILED', setupError: message },
            });
            return (0, whatsapp_account_service_js_1.toView)(row);
        }
    }
    async sweepPending() {
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            await this.prisma.whatsAppAccount.updateMany({
                where: {
                    setupStatus: 'VERIFYING',
                    updatedAt: { lt: new Date(Date.now() - VERIFYING_STALE_MS) },
                },
                data: {
                    setupStatus: 'FAILED',
                    setupError: 'WhatsApp setup was interrupted. Try again.',
                },
            });
            const rows = await this.prisma.whatsAppAccount.findMany({
                where: { setupStatus: 'PENDING_CODE' },
            });
            for (const row of rows) {
                await this.checkPending(row).catch((err) => this.logger.warn(`WhatsApp code sweep for company ${row.companyId} failed: ${String(err)}`));
            }
        }
        finally {
            this.sweeping = false;
        }
    }
    async checkPending(row) {
        const requestedAt = (row.codeRequestedAt ?? row.updatedAt).getTime();
        const support = await this.prisma.supportNumber.findFirst({
            where: { companyId: row.companyId, releasedAt: null },
            select: { phoneNumber: true },
        });
        if (support) {
            const messages = await this.signalwire.listMessages({
                to: support.phoneNumber,
                after: requestedAt - SMS_LOOKBACK_MS,
            });
            const code = messages
                .map((m) => (0, whatsapp_util_js_1.extractWhatsAppCode)(m.body))
                .find((c) => c !== null);
            if (code) {
                this.logger.log(`WhatsApp code found by sweep for company ${row.companyId}`);
                await this.complete(row, code);
                return;
            }
        }
        if (Date.now() - requestedAt > exports.CODE_TIMEOUT_MS) {
            await this.prisma.whatsAppAccount.updateMany({
                where: { id: row.id, setupStatus: 'PENDING_CODE' },
                data: {
                    setupStatus: 'FAILED',
                    setupError: "Meta's verification text never arrived at the support number. Try again to send a new code.",
                },
            });
        }
    }
    async addOrFind(wabaId, parts, verifiedName, token) {
        const digits = `${parts.cc}${parts.number}`;
        const found = await this.graph.findWabaPhoneNumber(wabaId, digits, token);
        if (found)
            return found;
        const id = await this.graph.addPhoneNumber(wabaId, parts.cc, parts.number, verifiedName, token);
        return this.graph.getPhoneNumber(id, token);
    }
    async subscribe(wabaId, token) {
        await this.graph.subscribeApp(wabaId, token).catch((err) => {
            this.logger.warn(`subscribeApp ${wabaId} failed: ${String(err)}`);
        });
    }
    upsert(companyId, data) {
        return this.prisma.whatsAppAccount.upsert({
            where: { companyId },
            create: { companyId, ...data },
            update: data,
        });
    }
};
exports.WhatsAppProvisioningService = WhatsAppProvisioningService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_30_SECONDS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], WhatsAppProvisioningService.prototype, "sweepPending", null);
exports.WhatsAppProvisioningService = WhatsAppProvisioningService = WhatsAppProvisioningService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        whatsapp_graph_service_js_1.WhatsAppGraphService,
        whatsapp_account_service_js_1.WhatsAppAccountService,
        phone_events_service_js_1.PhoneEventsService,
        signalwire_service_js_1.SignalWireService])
], WhatsAppProvisioningService);
//# sourceMappingURL=whatsapp-provisioning.service.js.map