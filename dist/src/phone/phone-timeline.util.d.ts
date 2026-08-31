import { type SwCall, type SwMessage } from './signalwire-parse.js';
import type { CallItemDto, PhoneItemDto } from './phone.types.js';
export declare const CALL_ID_PREFIX = "swcall:";
export declare const SMS_ID_PREFIX = "swsms:";
export declare const callItemId: (sid: string) => string;
export declare const smsItemId: (sid: string) => string;
export declare function isPhoneItemId(value: unknown): value is string;
export declare function e164FromSipUri(value: string | null | undefined): string | null;
export declare function legNumber(value: string | null | undefined): string | null;
export declare function counterpartyOfCall(call: SwCall, supportNumber: string): {
    counterparty: string;
    direction: 'inbound' | 'outbound';
} | null;
export declare function counterpartyOfMessage(msg: SwMessage, supportNumber: string): {
    counterparty: string;
    direction: 'inbound' | 'outbound';
} | null;
export declare function callOutcome(call: SwCall, direction: 'inbound' | 'outbound', child: SwCall | undefined): CallItemDto['outcome'];
export interface BuildInput {
    supportNumber: string;
    calls: SwCall[];
    sipLegs: SwCall[];
    messages: SwMessage[];
    recordedCallSids: Set<string>;
    readIds: Set<string>;
    completedIds: Set<string>;
}
export declare function buildPhoneItems(input: BuildInput): PhoneItemDto[];
