export declare function parseUserIdList(value: string | undefined): number[];
export declare class SendInternalMessageDto {
    to: string;
    cc?: string;
    subject?: string;
    body: string;
    bodyHtml?: string;
    parentId?: string;
    isForward?: string;
}
