"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendErrorStatus = sendErrorStatus;
exports.sendErrorCode = sendErrorCode;
exports.isAuthSendError = isAuthSendError;
exports.isRetryableSendError = isRetryableSendError;
exports.translateSendError = translateSendError;
const common_1 = require("@nestjs/common");
const LABEL = {
    gmail: 'Gmail',
    outlook: 'Outlook',
};
const NETWORK_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ERR_STREAM_PREMATURE_CLOSE',
    'ABORT_ERR',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
]);
function sendErrorStatus(err) {
    const e = (err ?? {});
    const raw = e.response?.status ?? e.status ?? e.statusCode ?? e.code;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n >= 100 && n < 600 ? n : 0;
}
function sendErrorCode(err) {
    const e = (err ?? {});
    if (e.graphCode)
        return e.graphCode;
    const reason = e.errors?.[0]?.reason;
    if (reason)
        return String(reason);
    const nested = e.response?.data?.error?.code;
    if (nested && !/^\d+$/.test(String(nested)))
        return String(nested);
    if (typeof e.code === 'string')
        return e.code;
    return '';
}
function messageOf(err) {
    if (err instanceof Error)
        return err.message;
    if (typeof err === 'string')
        return err;
    if (typeof err === 'number' || typeof err === 'boolean')
        return String(err);
    try {
        return JSON.stringify(err) ?? 'unknown error';
    }
    catch {
        return 'unknown error';
    }
}
function networkCode(err) {
    const e = (err ?? {});
    const own = typeof e.code === 'string' ? e.code : '';
    if (NETWORK_CODES.has(own))
        return own;
    const cause = (e.cause ?? {});
    const inner = typeof cause.code === 'string' ? cause.code : '';
    return NETWORK_CODES.has(inner) ? inner : '';
}
function haystack(err) {
    const e = (err ?? {});
    return [
        messageOf(err),
        sendErrorCode(err),
        e.response?.data?.error?.message ?? '',
        e.response?.data?.error?.status ?? '',
    ]
        .join(' ')
        .toLowerCase();
}
function isAuthSendError(err) {
    if (err instanceof common_1.HttpException)
        return false;
    if (sendErrorStatus(err) === 401)
        return true;
    const text = haystack(err);
    return (text.includes('invalid_grant') ||
        text.includes('invalid_client') ||
        text.includes('unauthorized_client') ||
        text.includes('token has been expired or revoked') ||
        text.includes('invalidauthenticationtoken'));
}
function isRetryableSendError(err) {
    if (err instanceof common_1.HttpException)
        return false;
    if (networkCode(err))
        return true;
    const e = (err ?? {});
    if (e.name === 'AbortError' || e.name === 'TimeoutError')
        return true;
    if (messageOf(err).toLowerCase() === 'fetch failed')
        return true;
    const status = sendErrorStatus(err);
    if (status === 408 || status === 429)
        return true;
    if (status >= 500 && status <= 599)
        return true;
    const code = sendErrorCode(err).toLowerCase();
    return (code === 'ratelimitexceeded' ||
        code === 'userratelimitexceeded' ||
        code === 'applicationthrottled' ||
        code === 'mailboxconcurrency' ||
        code === 'serviceunavailable' ||
        code === 'backenderror');
}
function translateSendError(err, provider, companyId, logger) {
    const label = LABEL[provider];
    const status = sendErrorStatus(err);
    const code = sendErrorCode(err);
    const detail = messageOf(err);
    const line = `sendEmail failed for company ${companyId} via ${provider}: ` +
        `status=${status || 'none'} code=${code || 'none'} — ${detail}`;
    if (err instanceof common_1.HttpException && err.getStatus() < 500) {
        logger.warn(line);
    }
    else {
        logger.error(line, err instanceof Error ? err.stack : undefined);
    }
    if (err instanceof common_1.HttpException)
        return err;
    const text = haystack(err);
    if (isAuthSendError(err)) {
        return new common_1.UnauthorizedException(`${label} rejected the sign-in for this mailbox. Open the Communications tab, ` +
            'disconnect it and connect it again, then resend.');
    }
    if (code === 'ENOENT') {
        return new common_1.BadRequestException('The attachments were cleaned up before the message finished sending. Please ' +
            'attach them again and resend.');
    }
    if (status === 413 ||
        text.includes('message too large') ||
        text.includes('request entity too large') ||
        text.includes('errormessagesizeexceeded') ||
        text.includes('maximum message size')) {
        return new common_1.BadRequestException('This message is too large to send. Remove or shrink an attachment and try ' +
            'again.');
    }
    if (text.includes('errorinvalidrecipients') ||
        text.includes('invalid to header') ||
        text.includes('invalid cc header') ||
        text.includes('invalid bcc header') ||
        text.includes('recipient address rejected')) {
        return new common_1.BadRequestException(`${label} rejected one of the recipient addresses. Check the To, Cc and Bcc ` +
            'fields and try again.');
    }
    if (isRetryableSendError(err)) {
        return new common_1.ServiceUnavailableException(`${label} is not responding right now. The message was not sent — please try ` +
            'again in a moment.');
    }
    if (status === 403) {
        return new common_1.BadRequestException(`${label} refused this send (${code || 'permission denied'}). The mailbox may ` +
            'be missing a permission — disconnecting and reconnecting it usually fixes ' +
            'this.');
    }
    return new common_1.HttpException(`Couldn't send the message through ${label}${code ? ` (${code})` : ''}. Please ` +
        'try again.', common_1.HttpStatus.BAD_GATEWAY);
}
//# sourceMappingURL=send-error.util.js.map