export declare function esc(value: unknown): string;
export declare function emptyResponse(): string;
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
export declare function dialSip(targets: SipTarget[], opts?: DialOptions): string;
export declare function dialNumber(e164: string, opts?: DialOptions): string;
