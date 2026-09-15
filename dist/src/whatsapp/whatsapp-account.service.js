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
var WhatsAppAccountService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppAccountService = exports.INTERNAL_MESSAGE = void 0;
exports.toView = toView;
exports.toHttpError = toHttpError;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const company_target_util_js_1 = require("../companies/company-target.util.js");
const crypto_util_js_1 = require("../communications/crypto.util.js");
const whatsapp_graph_service_js_1 = require("./whatsapp-graph.service.js");
const whatsapp_util_js_1 = require("./whatsapp.util.js");
exports.INTERNAL_MESSAGE = 'An internal workspace has no WhatsApp number to connect';
const CONNECTED_STATE = {
    setupStatus: 'CONNECTED',
    setupError: null,
    codeRequestedAt: null,
};
function toView(row) {
    return {
        companyId: row.companyId,
        wabaId: row.wabaId,
        phoneNumberId: row.phoneNumberId,
        displayPhoneNumber: row.displayPhoneNumber,
        verifiedName: row.verifiedName,
        usesFirmToken: row.accessToken === null,
        origin: row.origin,
        setupStatus: row.setupStatus,
        setupError: row.setupError,
        connectedAt: row.connectedAt.toISOString(),
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
let WhatsAppAccountService = WhatsAppAccountService_1 = class WhatsAppAccountService {
    prisma;
    graph;
    logger = new common_1.Logger(WhatsAppAccountService_1.name);
    constructor(prisma, graph) {
        this.prisma = prisma;
        this.graph = graph;
    }
    clientConfig() {
        const cfg = (0, whatsapp_util_js_1.whatsappConfig)(process.env);
        return {
            appId: cfg.appId,
            configId: cfg.configId,
            graphVersion: cfg.graphVersion,
            firmNumberAvailable: cfg.firmToken !== null && cfg.firmPhoneNumberId !== null,
            generateAvailable: cfg.firmToken !== null && cfg.firmWabaId !== null,
        };
    }
    async getAccount(companyId) {
        const row = await this.prisma.whatsAppAccount.findUnique({
            where: { companyId },
        });
        return row ? toView(row) : null;
    }
    async connect(companyId, dto, userId) {
        await (0, company_target_util_js_1.assertRealCompany)(this.prisma, companyId, exports.INTERNAL_MESSAGE);
        const key = this.encryptionKey();
        let token;
        try {
            token = await this.graph.exchangeCode(dto.code);
        }
        catch (err) {
            toHttpError(err);
        }
        let phone;
        try {
            const ids = await this.graph.listWabaPhoneNumberIds(dto.wabaId, token);
            if (!ids.includes(dto.phoneNumberId)) {
                throw new common_1.BadRequestException('That phone number does not belong to the WhatsApp Business account you connected');
            }
            phone = await this.graph.getPhoneNumber(dto.phoneNumberId, token);
        }
        catch (err) {
            toHttpError(err);
        }
        await this.assertNumberFree(dto.phoneNumberId, companyId);
        try {
            await this.graph.subscribeApp(dto.wabaId, token);
        }
        catch (err) {
            toHttpError(err);
        }
        let warning = null;
        let registrationPin = null;
        if (phone.status !== 'CONNECTED') {
            const pin = (0, crypto_1.randomInt)(0, 1_000_000).toString().padStart(6, '0');
            try {
                await this.graph.registerNumber(dto.phoneNumberId, pin, token);
                registrationPin = (0, crypto_util_js_1.encrypt)(pin, key);
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                this.logger.warn(`registerNumber ${dto.phoneNumberId} for company ${companyId} failed: ${detail}`);
                warning = `The number was connected, but WhatsApp did not finish registering it (${detail}). Messages may not send until it is registered in WhatsApp Manager.`;
            }
        }
        const data = {
            wabaId: dto.wabaId,
            phoneNumberId: dto.phoneNumberId,
            displayPhoneNumber: phone.displayPhoneNumber,
            verifiedName: phone.verifiedName,
            accessToken: (0, crypto_util_js_1.encrypt)(token, key),
            registrationPin,
            origin: 'SIGNUP',
            ...CONNECTED_STATE,
            connectedById: userId,
            connectedAt: new Date(),
        };
        const row = await this.prisma.whatsAppAccount.upsert({
            where: { companyId },
            create: { companyId, ...data },
            update: data,
        });
        this.logger.log(`company ${companyId} connected WhatsApp ${phone.displayPhoneNumber} (waba ${dto.wabaId}) by user ${userId}`);
        return { account: toView(row), warning };
    }
    async connectFirmNumber(companyId, userId) {
        await (0, company_target_util_js_1.assertRealCompany)(this.prisma, companyId, exports.INTERNAL_MESSAGE);
        const cfg = (0, whatsapp_util_js_1.whatsappConfig)(process.env);
        if (!cfg.firmToken || !cfg.firmPhoneNumberId) {
            throw new common_1.ServiceUnavailableException('The firm WhatsApp number is not configured on the server (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
        }
        let phone;
        try {
            phone = await this.graph.getPhoneNumber(cfg.firmPhoneNumberId, cfg.firmToken);
        }
        catch (err) {
            toHttpError(err);
        }
        await this.assertNumberFree(cfg.firmPhoneNumberId, companyId);
        let warning = null;
        if (cfg.firmWabaId) {
            try {
                await this.graph.subscribeApp(cfg.firmWabaId, cfg.firmToken);
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                warning = `Connected, but subscribing to its messages failed (${detail}). Incoming messages may not arrive.`;
            }
        }
        else {
            warning =
                'WHATSAPP_BUSINESS_ACCOUNT_ID is not set, so the webhook subscription was not checked.';
        }
        const data = {
            wabaId: cfg.firmWabaId ?? '',
            phoneNumberId: cfg.firmPhoneNumberId,
            displayPhoneNumber: phone.displayPhoneNumber,
            verifiedName: phone.verifiedName,
            accessToken: null,
            registrationPin: null,
            origin: 'FIRM',
            ...CONNECTED_STATE,
            connectedById: userId,
            connectedAt: new Date(),
        };
        const row = await this.prisma.whatsAppAccount.upsert({
            where: { companyId },
            create: { companyId, ...data },
            update: data,
        });
        this.logger.log(`company ${companyId} attached the firm WhatsApp number ${phone.displayPhoneNumber} by user ${userId}`);
        return { account: toView(row), warning };
    }
    async disconnect(companyId) {
        const row = await this.prisma.whatsAppAccount.findUnique({
            where: { companyId },
        });
        if (!row)
            throw new common_1.NotFoundException('No WhatsApp number is connected');
        if (row.accessToken) {
            const token = this.tokenFor(row);
            if (token && row.wabaId) {
                await this.graph.unsubscribeApp(row.wabaId, token).catch((err) => {
                    this.logger.warn(`unsubscribeApp ${row.wabaId} on disconnect failed: ${String(err)}`);
                });
            }
        }
        if (row.origin === 'GENERATED') {
            const token = (0, whatsapp_util_js_1.whatsappConfig)(process.env).firmToken;
            if (token) {
                await this.graph
                    .deregisterNumber(row.phoneNumberId, token)
                    .catch((err) => {
                    this.logger.warn(`deregisterNumber ${row.phoneNumberId} on disconnect failed: ${String(err)}`);
                });
            }
        }
        await this.prisma.whatsAppAccount.delete({ where: { companyId } });
        this.logger.log(`company ${companyId} disconnected WhatsApp ${row.displayPhoneNumber}`);
    }
    async requireActive(companyId) {
        const account = await this.prisma.whatsAppAccount.findUnique({
            where: { companyId },
        });
        if (!account) {
            throw new common_1.BadRequestException('No WhatsApp number is connected to this company');
        }
        if (account.setupStatus !== 'CONNECTED') {
            throw new common_1.BadRequestException('WhatsApp is still being set up for this company');
        }
        const token = this.tokenFor(account);
        if (!token) {
            throw new common_1.ServiceUnavailableException('The WhatsApp token for this company is unavailable. Reconnect WhatsApp.');
        }
        return { account, token };
    }
    async tokenForPhoneNumber(phoneNumberId) {
        const account = await this.prisma.whatsAppAccount.findUnique({
            where: { phoneNumberId },
        });
        if (account)
            return this.tokenFor(account);
        const cfg = (0, whatsapp_util_js_1.whatsappConfig)(process.env);
        return cfg.firmPhoneNumberId === phoneNumberId ? cfg.firmToken : null;
    }
    tokenFor(account) {
        if (!account.accessToken)
            return (0, whatsapp_util_js_1.whatsappConfig)(process.env).firmToken;
        try {
            return (0, crypto_util_js_1.decrypt)(account.accessToken, this.encryptionKey());
        }
        catch (err) {
            this.logger.error(`could not decrypt the WhatsApp token for company ${account.companyId}: ${String(err)}`);
            return null;
        }
    }
    async assertNumberFree(phoneNumberId, companyId) {
        const taken = await this.prisma.whatsAppAccount.findUnique({
            where: { phoneNumberId },
            select: { companyId: true },
        });
        if (taken && taken.companyId !== companyId) {
            throw new common_1.ConflictException('This WhatsApp number is already connected to another company');
        }
    }
    encryptionKey() {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
            throw new common_1.ServiceUnavailableException('ENCRYPTION_KEY is not configured, so a WhatsApp token cannot be stored');
        }
        return key;
    }
};
exports.WhatsAppAccountService = WhatsAppAccountService;
exports.WhatsAppAccountService = WhatsAppAccountService = WhatsAppAccountService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        whatsapp_graph_service_js_1.WhatsAppGraphService])
], WhatsAppAccountService);
//# sourceMappingURL=whatsapp-account.service.js.map