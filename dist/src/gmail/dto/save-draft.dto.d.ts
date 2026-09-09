export declare class SaveDraftDto {
    to?: string;
    subject?: string;
    body?: string;
    bodyHtml?: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    forwardedFrom?: string;
    forwardScope?: 'message' | 'thread';
    replyToMessageId?: string;
    draftKind?: 'reply' | 'forward';
    hasAttachments?: 'true' | 'false';
    setAttachments?: 'true' | 'false';
}
