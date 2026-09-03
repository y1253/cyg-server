export declare function esc(value: unknown): string;
export declare function response(children: string): string;
export declare function emptyResponse(): string;
export declare function sayVerb(text: string, opts?: {
    voice?: string;
}): string;
export declare function hangupVerb(): string;
export declare function say(text: string, opts?: {
    voice?: string;
}): string;
export declare function sayAndHangup(text: string, opts?: {
    voice?: string;
}): string;
export declare function hangup(): string;
export interface SipTarget {
    uri: string;
    headers?: Record<string, string | number>;
}
export interface DialOptions {
    timeout?: number;
    callerId?: string;
    action?: string;
    record?: string;
}
export declare function dialSipVerb(targets: SipTarget[], opts?: DialOptions): string;
export declare function dialSip(targets: SipTarget[], opts?: DialOptions): string;
export declare function dialNumberVerb(e164: string, opts?: DialOptions): string;
export declare function dialNumber(e164: string, opts?: DialOptions): string;
export declare function sayThenDialSip(text: string | null, targets: SipTarget[], opts?: DialOptions & {
    voice?: string;
}): string;
export interface RecordOptions {
    action?: string;
    maxLength?: number;
    timeout?: number;
    finishOnKey?: string;
    playBeep?: boolean;
}
export declare function recordVerb(opts?: RecordOptions): string;
export declare function record(opts?: RecordOptions): string;
export declare function sayThenRecord(text: string | null, opts?: RecordOptions & {
    voice?: string;
}): string;
