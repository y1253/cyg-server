import {
  IsOptional,
  IsString,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Validates a comma-separated list of positive integer user ids ("3,7,12").
 *
 * Recipients arrive as a joined string rather than an array because these are
 * multipart/form-data fields (attachments ride along on the same request) and the
 * global ValidationPipe runs WITHOUT `transform: true` — so every field lands as a
 * string. Mirrors `IsEmailList` in gmail/dto/send-email.dto.ts.
 */
function IsUserIdList(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isUserIdList',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const parts = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          return (
            parts.length > 0 && parts.every((p) => /^[1-9]\d{0,9}$/.test(p))
          );
        },
        defaultMessage() {
          return 'each recipient must be a positive user id';
        },
      },
    });
  };
}

/** Parse a validated id list into numbers, de-duplicated and order-preserving. */
export function parseUserIdList(value: string | undefined): number[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

export class SendInternalMessageDto {
  @IsUserIdList()
  to: string;

  @IsOptional()
  @IsUserIdList()
  cc?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  /** Plain-text body, used for snippets and AI polish. May be empty: a message
   *  carrying only attachments is legitimate. Still required to be *present* —
   *  see the note in send-email.dto.ts. */
  @IsString()
  body: string;

  /** Rich-text body from the editor. Rendered in a sandboxed iframe on read. */
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  /**
   * The message being replied to or forwarded. Its thread is inherited, so the
   * reply lands in the same conversation. Numeric string (multipart field).
   */
  @IsOptional()
  @IsString()
  parentId?: string;

  /** '1'/'true' when this send is a forward rather than a reply. */
  @IsOptional()
  @IsString()
  isForward?: string;
}
