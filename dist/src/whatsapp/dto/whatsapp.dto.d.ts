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
}
