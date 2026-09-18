import type { WhatsAppDeliveryStatus, WhatsAppMessageType, WhatsAppTemplateDto } from './whatsapp.types.js';
export declare const WHATSAPP_ITEM_PREFIX = "wa:";
export declare function whatsappItemId(messageId: number): string;
export interface WhatsAppConfig {
    appId: string | null;
    appSecret: string | null;
    configId: string | null;
    verifyToken: string | null;
    graphVersion: string;
    firmToken: string | null;
    firmPhoneNumberId: string | null;
    firmWabaId: string | null;
    displayName: string;
}
export declare function whatsappConfig(env: NodeJS.ProcessEnv): WhatsAppConfig;
export declare function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined, secret: string | null): boolean;
export declare function normalizeWaId(raw: unknown): string | null;
export declare function parseWaTimestamp(raw: unknown, fallback: Date): Date;
export declare const REPLY_WINDOW_MS: number;
export declare function windowOpenUntil(lastInboundAt: Date | null): Date | null;
export declare function isWindowOpen(lastInboundAt: Date | null, now: Date): boolean;
export declare function nextDeliveryStatus(current: string | null, incoming: WhatsAppDeliveryStatus): WhatsAppDeliveryStatus;
export interface ParsedInboundMessage {
    wamid: string;
    from: string;
    profileName: string | null;
    type: WhatsAppMessageType;
    body: string | null;
    mediaId: string | null;
    mimeType: string | null;
    filename: string | null;
    isVoice: boolean;
    at: Date;
    replyToWamid: string | null;
}
export interface ParsedStatus {
    wamid: string;
    status: WhatsAppDeliveryStatus;
    errorCode: string | null;
}
export interface ParsedChange {
    phoneNumberId: string;
    messages: ParsedInboundMessage[];
    statuses: ParsedStatus[];
}
export declare function parseWebhook(body: unknown, now?: Date): ParsedChange[];
export declare function graphErrorOf(data: unknown): {
    message: string;
    code: number | null;
    subcode: number | null;
} | null;
export type WhatsAppMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';
export declare const WHATSAPP_MEDIA_MAX_BYTES: Record<WhatsAppMediaKind, number>;
export declare function whatsappMediaKind(mime: string | null | undefined, filename: string | null | undefined): WhatsAppMediaKind;
export declare function whatsappAcceptsCaption(kind: WhatsAppMediaKind): boolean;
export declare const WHATSAPP_MAX_CAPTION = 1024;
export declare function baseMime(mime: string | null | undefined): string | null;
export declare function extensionForMime(mime: string | null | undefined): string;
export declare function mediaFilename(type: string, filename: string | null, messageId: number, mime: string | null): string;
export declare const WHATSAPP_VOICE_ARGS: string[];
export declare const WHATSAPP_PLAYBACK_MP3_ARGS: string[];
export declare function splitNanpNumber(e164: string | null | undefined): {
    cc: string;
    number: string;
} | null;
export declare function extractWhatsAppCode(body: unknown): string | null;
export declare function shouldRetryByVoice(code: number | null): boolean;
export declare function extractSpokenCode(transcript: unknown): string | null;
export declare const MAX_DISPLAY_NAME = 64;
export declare function toDisplayName(businessName: string): string;
export declare function friendlyGraphMessage(code: number | null, fallback: string): string;
export declare function whatsappPreview(type: string, body: string | null, isVoice: boolean): string;
export interface RawTemplate {
    id?: string;
    name?: string;
    language?: string;
    status?: string;
    category?: string;
    rejected_reason?: string;
    components?: {
        type?: string;
        text?: string;
    }[];
}
export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL' | 'PENDING_DELETION';
export declare function asTemplateStatus(raw: string | null | undefined): TemplateStatus | null;
export declare function isSettledTemplateStatus(status: string): boolean;
export declare function normalizeTemplatePlaceholders(body: string): {
    body: string;
    count: number;
};
export interface GeneratedTemplate {
    category: TemplateCategory | null;
    body: string;
    examples: string[];
}
export declare function parseGeneratedTemplate(raw: string): GeneratedTemplate;
export interface SubmissionRow {
    id: number;
    name: string;
    language: string;
    category: string;
    body: string;
    examples: string | null;
    status: string;
    rejectedReason: string | null;
    createdAt: Date;
}
export declare function toSubmissionDto(row: SubmissionRow, patch?: {
    status: string;
    rejectedReason: string | null;
}): {
    id: number;
    name: string;
    language: string;
    category: string;
    body: string;
    examples: string[];
    status: string;
    rejectedReason: string | null;
    submittedAt: string;
};
export declare function isSendableTemplate(status: string | null | undefined): boolean;
export declare function suggestTemplateName(description: string, taken?: readonly string[]): string;
export declare function isValidTemplateName(name: string): boolean;
export declare function isValidTemplateLanguage(language: string): boolean;
export declare const TEMPLATE_CATEGORIES: readonly ["UTILITY", "MARKETING"];
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export declare function buildTemplateComponents(body: string, examples?: readonly string[]): unknown[];
export declare function countTemplateVariables(body: string): number;
export declare function toTemplate(raw: RawTemplate): WhatsAppTemplateDto | null;
export declare function renderTemplateBody(body: string, variables: readonly string[]): string;
export declare function templateComponents(variables: readonly string[]): unknown[];
