export declare class SendEmailDto {
    to: string;
    subject: string;
    body: string;
    bodyHtml?: string;
    cc?: string;
    inReplyTo?: string;
    threadId?: string;
}
