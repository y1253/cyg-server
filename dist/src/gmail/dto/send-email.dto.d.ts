import { ValidationOptions } from 'class-validator';
export declare function IsEmailList(validationOptions?: ValidationOptions & {
    allowEmpty?: boolean;
}): (object: object, propertyName: string) => void;
export declare class SendEmailDto {
    to: string;
    subject?: string;
    body: string;
    bodyHtml?: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    forwardedFrom?: string;
    forwardScope?: 'message' | 'thread';
    replyToMessageId?: string;
}
