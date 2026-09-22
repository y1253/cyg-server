export declare const ACCEPT_DIGIT = "1";
export declare const SCREEN_TIMEOUT_SEC = 8;
export declare function spokenDigits(e164: string | null | undefined): string;
export interface WhisperInput {
    companyName: string | null;
    from: string;
    fromName: string | null;
}
export declare function whisperText(input: WhisperInput): string;
export declare function whisperRepeat(): string;
export declare function whisperDoc(input: WhisperInput & {
    action: string;
    voice?: string;
}): string;
