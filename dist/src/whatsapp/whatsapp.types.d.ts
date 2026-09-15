export type WhatsAppDirection = 'inbound' | 'outbound';
export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppMediaStatus = 'pending' | 'ready' | 'failed';
export type WhatsAppMessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contacts' | 'reaction' | 'interactive' | 'button' | 'unsupported';
export interface WhatsAppAccountView {
    companyId: number;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    usesFirmToken: boolean;
    connectedAt: string;
}
export interface WhatsAppConnectResult {
    account: WhatsAppAccountView;
    warning: string | null;
}
export interface WhatsAppClientConfig {
    appId: string | null;
    configId: string | null;
    graphVersion: string;
    firmNumberAvailable: boolean;
}
export interface WhatsAppItemDto {
    id: string;
    messageId: number;
    kind: 'whatsapp';
    direction: WhatsAppDirection;
    peer: string;
    peerName: string | null;
    type: WhatsAppMessageType;
    body: string | null;
    isVoice: boolean;
    durationSec: number | null;
    hasMedia: boolean;
    mediaStatus: WhatsAppMediaStatus | null;
    mimeType: string | null;
    filename: string | null;
    size: number | null;
    status: WhatsAppDeliveryStatus | null;
    errorCode: string | null;
    at: string;
    isRead: boolean;
    isCompleted: boolean;
}
export interface WhatsAppTimelineResult {
    items: WhatsAppItemDto[];
    nextCursor: number | null;
    hasMore: boolean;
    connected: boolean;
}
export interface WhatsAppThreadResult {
    messages: WhatsAppItemDto[];
    peer: string;
    peerName: string | null;
    windowOpenUntil: string | null;
    connected: boolean;
}
export interface WhatsAppCounts {
    unread: number;
    uncompleted: number;
}
export type WhatsAppStateAction = 'read' | 'unread' | 'complete' | 'uncomplete';
