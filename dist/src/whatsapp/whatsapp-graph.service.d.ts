import { type WhatsAppMediaKind } from './whatsapp.util.js';
import type { WhatsAppTemplateDto } from './whatsapp.types.js';
export declare class WhatsAppGraphError extends Error {
    readonly httpStatus: number;
    readonly code: number | null;
    readonly subcode: number | null;
    constructor(message: string, httpStatus: number, code?: number | null, subcode?: number | null);
}
export interface WabaPhoneNumber {
    id: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    codeVerificationStatus: string | null;
    status: string | null;
}
export declare class WhatsAppGraphService {
    private readonly logger;
    private get base();
    private call;
    exchangeCode(code: string): Promise<string>;
    getPhoneNumber(phoneNumberId: string, token: string): Promise<WabaPhoneNumber>;
    addPhoneNumber(wabaId: string, cc: string, phoneNumber: string, verifiedName: string, token: string): Promise<string>;
    findWabaPhoneNumber(wabaId: string, digits: string, token: string): Promise<WabaPhoneNumber | null>;
    requestCode(phoneNumberId: string, token: string): Promise<void>;
    verifyCode(phoneNumberId: string, code: string, token: string): Promise<void>;
    deregisterNumber(phoneNumberId: string, token: string): Promise<void>;
    listWabaPhoneNumberIds(wabaId: string, token: string): Promise<string[]>;
    subscribeApp(wabaId: string, token: string): Promise<void>;
    unsubscribeApp(wabaId: string, token: string): Promise<void>;
    registerNumber(phoneNumberId: string, pin: string, token: string): Promise<void>;
    sendText(phoneNumberId: string, token: string, to: string, body: string, replyToWamid?: string | null): Promise<string>;
    listTemplates(wabaId: string, token: string): Promise<WhatsAppTemplateDto[]>;
    sendTemplate(phoneNumberId: string, token: string, to: string, name: string, language: string, components: unknown[]): Promise<string>;
    sendMedia(phoneNumberId: string, token: string, to: string, kind: WhatsAppMediaKind, mediaId: string, opts?: {
        caption?: string | null;
        filename?: string | null;
        replyToWamid?: string | null;
    }): Promise<string>;
    sendAudio(phoneNumberId: string, token: string, to: string, mediaId: string): Promise<string>;
    private sendMessage;
    uploadMedia(phoneNumberId: string, token: string, bytes: Buffer, mimeType: string, filename: string): Promise<string>;
    uploadMediaFromFile(phoneNumberId: string, token: string, absolutePath: string, mimeType: string, filename: string): Promise<string>;
    downloadMedia(mediaId: string, token: string): Promise<{
        bytes: Buffer;
        mimeType: string | null;
    }>;
}
