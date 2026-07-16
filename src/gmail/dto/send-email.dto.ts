import {
  IsNotEmpty,
  IsOptional,
  IsString,
  isEmail,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

// Validates a comma-separated list of email addresses (e.g. "a@b.com, c@d.com").
// Requires at least one part and every part to be a valid email — lets To/Cc carry
// multiple recipients (RFC 5322 headers accept the comma-joined string as-is).
function IsEmailList(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEmailList',
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
          return parts.length > 0 && parts.every((p) => isEmail(p));
        },
        defaultMessage() {
          return 'each recipient must be a valid email address';
        },
      },
    });
  };
}

export class SendEmailDto {
  @IsEmailList()
  to: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  // Optional HTML representation of the body (rich-text compose/reply). When
  // present, the message is sent as multipart/alternative with `body` as the
  // plain-text fallback.
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsEmailList()
  cc?: string;

  @IsOptional()
  @IsString()
  inReplyTo?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  // When forwarding, the Gmail message id of the ORIGINAL message being forwarded.
  // Recorded server-side so the inbox can mark that message as forwarded.
  @IsOptional()
  @IsString()
  forwardedFrom?: string;
}
