export declare class ConnectWhatsAppDto {
    code: string;
    wabaId: string;
    phoneNumberId: string;
}
export declare class SendWhatsAppTemplateDto {
    to: string;
    name: string;
    language: string;
    variables?: string[];
}
export declare class SendWhatsAppDto {
    to: string;
    body: string;
    replyToMessageId?: number;
}
export declare class CreateWhatsAppTemplateDto {
    name: string;
    language: string;
    category: string;
    body: string;
    examples?: string[];
}
export declare class GenerateWhatsAppTemplateDto {
    description: string;
}
