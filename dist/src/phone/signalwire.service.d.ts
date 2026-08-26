import { ConfigService } from '@nestjs/config';
import { type AvailableNumber, type IsoCountry, type PurchasedNumber } from './signalwire-parse.js';
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
}
