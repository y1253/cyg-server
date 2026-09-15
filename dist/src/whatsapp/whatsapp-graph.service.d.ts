export declare class WhatsAppGraphError extends Error {
    readonly httpStatus: number;
    readonly code: number | null;
    readonly subcode: number | null;
    constructor(message: string, httpStatus: number, code?: number | null, subcode?: number | null);
}
export declare class WhatsAppGraphService {
    private readonly logger;
    private get base();
    private call;
    exchangeCode(code: string): Promise<string>;
    getPhoneNumber(phoneNumberId: string, token: string): Promise<{
        id: string;
        displayPhoneNumber: string;
        verifiedName: string | null;
        status: string | null;
    }>;
    listWabaPhoneNumberIds(wabaId: string, token: string): Promise<string[]>;
    subscribeApp(wabaId: string, token: string): Promise<void>;
    unsubscribeApp(wabaId: string, token: string): Promise<void>;
    registerNumber(phoneNumberId: string, pin: string, token: string): Promise<void>;
    sendText(phoneNumberId: string, token: string, to: string, body: string): Promise<string>;
    sendAudio(phoneNumberId: string, token: string, to: string, mediaId: string): Promise<string>;
    private sendMessage;
    uploadMedia(phoneNumberId: string, token: string, bytes: Buffer, mimeType: string, filename: string): Promise<string>;
    downloadMedia(mediaId: string, token: string): Promise<{
        bytes: Buffer;
        mimeType: string | null;
    }>;
}
