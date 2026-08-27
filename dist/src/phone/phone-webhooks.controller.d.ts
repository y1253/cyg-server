export declare class PhoneWebhooksController {
    private readonly logger;
    private assertSigned;
    voiceInbound(signature: string | undefined, body: Record<string, unknown>): string;
    voiceStatus(signature: string | undefined, body: Record<string, unknown>): string;
    smsInbound(signature: string | undefined, body: Record<string, unknown>): string;
}
