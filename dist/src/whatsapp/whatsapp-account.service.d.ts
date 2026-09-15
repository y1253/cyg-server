import type { WhatsAppAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsAppGraphService } from './whatsapp-graph.service.js';
import type { ConnectWhatsAppDto } from './dto/whatsapp.dto.js';
import type { WhatsAppAccountView, WhatsAppClientConfig, WhatsAppConnectResult } from './whatsapp.types.js';
export declare const INTERNAL_MESSAGE = "An internal workspace has no WhatsApp number to connect";
export declare function toView(row: WhatsAppAccount): WhatsAppAccountView;
export declare function toHttpError(err: unknown): never;
export declare class WhatsAppAccountService {
    private readonly prisma;
    private readonly graph;
    private readonly logger;
    constructor(prisma: PrismaService, graph: WhatsAppGraphService);
    clientConfig(): WhatsAppClientConfig;
    getAccount(companyId: number): Promise<WhatsAppAccountView | null>;
    connect(companyId: number, dto: ConnectWhatsAppDto, userId: number): Promise<WhatsAppConnectResult>;
    connectFirmNumber(companyId: number, userId: number): Promise<WhatsAppConnectResult>;
    disconnect(companyId: number): Promise<void>;
    requireActive(companyId: number): Promise<{
        account: WhatsAppAccount;
        token: string;
    }>;
    tokenForPhoneNumber(phoneNumberId: string): Promise<string | null>;
    tokenFor(account: WhatsAppAccount): string | null;
    assertNumberFree(phoneNumberId: string, companyId: number): Promise<void>;
    encryptionKey(): string;
}
