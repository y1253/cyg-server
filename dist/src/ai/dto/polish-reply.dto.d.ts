export declare const POLISH_KINDS: readonly ["email", "chat", "sms", "whatsapp"];
export type PolishKind = (typeof POLISH_KINDS)[number];
export declare class PolishReplyDto {
    kind: PolishKind;
    draft: string;
    context: string;
    maxChars?: number;
}
