import { type SwCall, type SwMessage, type SwRecording } from './signalwire-parse.js';
import type { CallItemDto, PhoneItemDto } from './phone.types.js';
export declare const CALL_ID_PREFIX = "swcall:";
export declare const SMS_ID_PREFIX = "swsms:";
export declare const callItemId: (sid: string) => string;
export declare const smsItemId: (sid: string) => string;
export declare function isPhoneItemId(value: unknown): value is string;
export declare function e164FromSipUri(value: string | null | undefined): string | null;
export declare function legNumber(value: string | null | undefined): string | null;
export declare function agentIsOnRoot(root: {
    to: string;
}): boolean;
export declare function counterpartyOfCall(call: SwCall, supportNumber: string): {
    counterparty: string;
    direction: 'inbound' | 'outbound';
} | null;
export declare function counterpartyOfMessage(msg: SwMessage, supportNumber: string): {
    counterparty: string;
    direction: 'inbound' | 'outbound';
} | null;
export declare const UNCONNECTED: Set<string>;
export declare const LIVE: Set<string>;
export declare function callOutcome(call: SwCall, direction: 'inbound' | 'outbound', child: SwCall | undefined): CallItemDto['outcome'];
export declare const MIN_RECORDING_SECONDS = 3;
export declare function isAudibleRecording(r: SwRecording, minSec?: number): boolean;
export interface BuildInput {
    supportNumber: string;
    calls: SwCall[];
    sipLegs: SwCall[];
    messages: SwMessage[];
    recordings: SwRecording[];
    minRecordingSec?: number;
    readIds: Set<string>;
    completedIds: Set<string>;
    contactNames?: Map<string, string>;
}
export declare function buildPhoneItems(input: BuildInput): PhoneItemDto[];
