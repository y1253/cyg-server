import { ConfigService } from '@nestjs/config';
import { type AvailableNumber, type IsoCountry, type PurchasedNumber, type SwCall, type SwMessage, type SwRecording } from './signalwire-parse.js';
export interface PurchaseInput {
    phoneNumber: string;
    friendlyName?: string;
    voiceUrl?: string;
    smsUrl?: string;
    statusCallback?: string;
}
export interface SearchOptions {
    areaCode?: string;
    inRegion?: string;
    inLocality?: string;
}
export declare class SignalWireService {
    private readonly logger;
    private readonly baseUrl;
    private readonly authHeader;
    private readonly timeoutOverride;
    constructor(config: ConfigService);
    private call;
    searchAvailable(country: IsoCountry, opts?: SearchOptions): Promise<AvailableNumber[]>;
    purchaseNumber(input: PurchaseInput): Promise<PurchasedNumber>;
    releaseNumber(sid: string): Promise<void>;
    listOwned(pageSize?: number): Promise<PurchasedNumber[]>;
    listCalls(opts: {
        to?: string;
        from?: string;
        after?: number;
        before?: number;
        pageSize?: number;
    }): Promise<SwCall[]>;
    listMessages(opts: {
        to?: string;
        from?: string;
        after?: number;
        before?: number;
        pageSize?: number;
    }): Promise<SwMessage[]>;
    getCall(sid: string): Promise<SwCall | null>;
    listRecordings(opts?: {
        callSid?: string;
        pageSize?: number;
    }): Promise<SwRecording[]>;
    fetchRecordingMedia(sid: string): Promise<{
        buffer: Buffer;
        contentType: string;
    }>;
    sendSms(input: {
        to: string;
        from: string;
        body: string;
    }): Promise<SwMessage>;
    createCall(input: {
        to: string;
        from: string;
        laml: string;
        statusCallback?: string;
        timeoutSec?: number;
    }): Promise<SwCall>;
}
