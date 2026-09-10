export type SmsKeyword = 'stop' | 'help' | 'start';
export declare const OPT_OUT_REPLY: string;
export declare const HELP_REPLY: string;
export declare const OPT_IN_REPLY: string;
export declare function classifyInboundSms(body: unknown): SmsKeyword | null;
export declare function replyFor(keyword: SmsKeyword): string;
