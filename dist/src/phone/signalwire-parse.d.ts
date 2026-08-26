export type SignalWireJson = Record<string, unknown> | unknown[] | null;
export type CapabilityFlag = boolean | null;
export interface AvailableNumber {
    phoneNumber: string;
    friendlyName: string | null;
    region: string | null;
    rateCenter: string | null;
    locality: string | null;
    voice: boolean;
    sms: boolean;
    mms: boolean;
}
export interface PurchasedNumber {
    sid: string;
    phoneNumber: string;
    friendlyName: string | null;
    voiceUrl: string | null;
    smsUrl: string | null;
    voice: CapabilityFlag;
    sms: CapabilityFlag;
    mms: CapabilityFlag;
    capabilitiesRaw: string | null;
}
export type IsoCountry = 'US' | 'CA';
export declare function toIsoCountry(country: string | null | undefined): IsoCountry | null;
export declare function isValidAreaCode(value: string | null | undefined): boolean;
export declare function isE164(value: string | null | undefined): boolean;
export declare function areaCodeOf(e164: string | null | undefined): string | null;
export declare function parseAvailableNumbers(data: SignalWireJson): AvailableNumber[];
export declare function parsePurchasedNumber(data: SignalWireJson): PurchasedNumber | null;
export declare function parseOwnedNumbers(data: SignalWireJson): PurchasedNumber[];
export declare function signalwireErrorMessage(data: SignalWireJson, raw: string): string;
