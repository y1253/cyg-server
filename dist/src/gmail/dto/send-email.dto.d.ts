export declare class SendEmailDto {
    to: string;
    subject?: string;
    body: string;
    bodyHtml?: string;
    cc?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    forwardedFrom?: string;
    forwardScope?: 'message' | 'thread';
    replyToMessageId?: string;
}
