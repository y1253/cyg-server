export declare function esc(value: unknown): string;
export declare function response(children: string): string;
export declare function emptyResponse(): string;
export declare function sayVerb(text: string, opts?: {
    voice?: string;
}): string;
export declare function messageVerb(text: string): string;
export declare function message(text: string): string;
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
export interface ConferenceOptions {
    startOnEnter?: boolean;
    endOnExit?: boolean;
    beep?: 'true' | 'false' | 'onEnter' | 'onExit';
    record?: string;
    statusCallback?: string;
    statusCallbackEvent?: string;
    waitUrl?: string;
    waitMethod?: 'GET' | 'POST';
    muted?: boolean;
    maxParticipants?: number;
}
export declare function conferenceVerb(room: string, conf?: ConferenceOptions, dial?: DialOptions): string;
export declare function playVerb(url: string, opts?: {
    loop?: number;
}): string;
export declare function play(url: string, opts?: {
    loop?: number;
}): string;
export declare function dialConference(room: string, conf?: ConferenceOptions, dial?: DialOptions): string;
