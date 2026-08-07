import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { MAX_ATTACHMENTS, MAX_OUTBOUND_FILE_BYTES } from './outbound-uploads.js';

/**
 * Turn multer's upload limits into something the user can act on.
 *
 * Without this a `MulterError` escapes as a bare 500 and the composer renders
 * "Failed to send" — which is exactly wrong when the real problem is a file the
 * user could remove, or a quoted conversation long enough to blow the per-field
 * cap. `LIMIT_FIELD_VALUE` in particular is reachable from ordinary use: a
 * whole-conversation forward carries every quoted message in `bodyHtml`.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MulterExceptionFilter.name);

  catch(err: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

    let message: string;
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        message = `That attachment is over the ${mb(MAX_OUTBOUND_FILE_BYTES)} MB limit for a single file.`;
        break;
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        message = `You can attach at most ${MAX_ATTACHMENTS} files to one message.`;
        break;
      case 'LIMIT_FIELD_VALUE':
        message =
          'This message is too long to send — try forwarding fewer messages of ' +
          'the conversation, or removing large images from the quoted text.';
        break;
      default:
        message = 'The message could not be uploaded. Please try again.';
    }

    this.logger.warn(`multer ${err.code} on ${host.switchToHttp().getRequest().url}`);
    res.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
    });
  }
}
