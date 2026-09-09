import { HttpException, Logger } from '@nestjs/common';
export type SendProvider = 'gmail' | 'outlook';
export declare function sendErrorStatus(err: unknown): number;
export declare function sendErrorCode(err: unknown): string;
export declare function isAuthSendError(err: unknown): boolean;
export declare function isRetryableSendError(err: unknown): boolean;
export declare function translateSendError(err: unknown, provider: SendProvider, companyId: number, logger: Logger): HttpException;
export declare function translateDraftError(err: unknown, provider: SendProvider, companyId: number, logger: Logger): HttpException;
