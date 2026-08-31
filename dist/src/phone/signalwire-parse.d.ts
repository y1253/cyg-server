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
export interface SwCall {
    sid: string;
    parentCallSid: string | null;
    to: string;
    from: string;
    direction: string;
    status: string;
    startedAt: number;
    durationSec: number;
}
export interface SwMessage {
    sid: string;
    to: string;
    from: string;
    direction: string;
    status: string;
    body: string;
    numMedia: number;
    sentAt: number;
    errorCode: number | null;
}
export interface SwRecording {
    sid: string;
    callSid: string | null;
    durationSec: number;
    status: string;
    createdAt: number | null;
}
export declare function parseSwDate(value: unknown): number | null;
export declare function isOutbound(direction: string | null | undefined): boolean;
export declare function parseCalls(data: SignalWireJson): SwCall[];
export declare function parseMessages(data: SignalWireJson): SwMessage[];
export declare function parseRecordings(data: SignalWireJson): SwRecording[];
