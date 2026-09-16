import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppProvisioningService } from './whatsapp-provisioning.service.js';
import { WhatsAppMessagesService, type UploadedVoice } from './whatsapp-messages.service.js';
import { ConnectWhatsAppDto, SendWhatsAppDto, SendWhatsAppTemplateDto } from './dto/whatsapp.dto.js';
type AuthedRequest = {
    user: {
        userId: number;
    };
};
export declare class WhatsAppController {
    private readonly accounts;
    private readonly messages;
    private readonly provisioning;
    constructor(accounts: WhatsAppAccountService, messages: WhatsAppMessagesService, provisioning: WhatsAppProvisioningService);
    config(): import("./whatsapp.types.js").WhatsAppClientConfig;
    account(companyId: number): Promise<{
        account: import("./whatsapp.types.js").WhatsAppAccountView | null;
    }>;
    connect(companyId: number, dto: ConnectWhatsAppDto, req: AuthedRequest): Promise<import("./whatsapp.types.js").WhatsAppConnectResult>;
    generate(companyId: number, req: AuthedRequest): Promise<import("./whatsapp.types.js").WhatsAppAccountView>;
    connectFirmNumber(companyId: number, req: AuthedRequest): Promise<import("./whatsapp.types.js").WhatsAppConnectResult>;
    disconnect(companyId: number): Promise<void>;
    timeline(companyId: number, cursor?: string, limit?: string): Promise<import("./whatsapp.types.js").WhatsAppTimelineResult>;
    thread(companyId: number, peer: string): Promise<import("./whatsapp.types.js").WhatsAppThreadResult>;
    counts(companyId: number): Promise<import("./whatsapp.types.js").WhatsAppCounts>;
    send(companyId: number, dto: SendWhatsAppDto, req: AuthedRequest): Promise<import("./whatsapp.types.js").WhatsAppItemDto>;
    templates(companyId: number): Promise<import("./whatsapp.types.js").WhatsAppTemplateDto[]>;
    sendTemplate(companyId: number, dto: SendWhatsAppTemplateDto, req: AuthedRequest): Promise<import("./whatsapp.types.js").WhatsAppItemDto>;
    sendVoice(companyId: number, file: UploadedVoice | undefined, to: string | undefined, req: AuthedRequest): Promise<import("./whatsapp.types.js").WhatsAppItemDto>;
    setState(companyId: number, messageId: number, action: string): Promise<void>;
}
export {};
