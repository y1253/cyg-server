export declare class GraphError extends Error {
    status: number;
    graphCode: string | null;
    wwwAuthenticate: string | null;
    constructor(status: number, graphCode: string | null, message: string, wwwAuthenticate?: string | null);
}
export declare function graphGet<T>(accessToken: string, urlOrPath: string, headers?: Record<string, string>): Promise<T>;
export declare function graphPost<T>(accessToken: string, path: string, body: unknown, headers?: Record<string, string>): Promise<T | null>;
export declare function graphPatch(accessToken: string, path: string, body: unknown, headers?: Record<string, string>): Promise<void>;
export declare function graphDelete(accessToken: string, path: string): Promise<void>;
export declare function graphGetBinary(accessToken: string, path: string): Promise<Buffer>;
export interface GraphList<T> {
    value: T[];
    '@odata.nextLink'?: string;
}
export interface GraphEmailAddress {
    emailAddress?: {
        name?: string;
        address?: string;
    };
}
export interface GraphMessage {
    id: string;
    subject?: string;
    bodyPreview?: string;
    from?: GraphEmailAddress;
    sender?: GraphEmailAddress;
    toRecipients?: GraphEmailAddress[];
    receivedDateTime?: string;
    sentDateTime?: string;
    isRead?: boolean;
    hasAttachments?: boolean;
    conversationId?: string;
    internetMessageId?: string;
    body?: {
        contentType?: string;
        content?: string;
    };
    attachments?: GraphAttachment[];
}
export interface GraphAttachment {
    id: string;
    name?: string;
    contentType?: string;
    size?: number;
    isInline?: boolean;
    contentId?: string;
    '@odata.type'?: string;
}
export interface GraphChatMember {
    displayName?: string;
    userId?: string;
}
export interface GraphChatMessageAttachment {
    id?: string;
    contentType?: string;
    contentUrl?: string;
    name?: string;
    thumbnailUrl?: string;
}
export interface GraphChatMessage {
    id: string;
    messageType?: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    from?: {
        user?: {
            id?: string;
            displayName?: string;
        };
    };
    body?: {
        contentType?: string;
        content?: string;
    };
    attachments?: GraphChatMessageAttachment[];
}
export interface GraphChat {
    id: string;
    topic?: string | null;
    chatType?: string;
    members?: GraphChatMember[];
    lastMessagePreview?: GraphChatMessage;
}
export declare function formatGraphAddress(a?: GraphEmailAddress): string;
export declare function formatGraphAddressList(list?: GraphEmailAddress[]): string;
export declare function htmlToText(html: string | undefined | null): string;
export declare const TEAMS_PREFIX = "msteams:";
export declare function teamsStateId(chatId: string, messageId: string): string;
export declare function chatDisplayName(chat: GraphChat, selfUserId: string | null): string;
export declare function chatSpaceType(chatType: string | undefined): string;
