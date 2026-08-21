import {
  IsIn,
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

  // Not @IsNotEmpty: a message carrying only attachments is legitimate, and
  // that is what an attachment-only send arrives as. @IsString stays, and the
  // distinction matters — '' is safe everywhere downstream, but a *missing*
  // field would reach `Buffer.from(undefined)` in the MIME builder and turn a
  // clean 400 into a 500.
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

  // The References chain of the message being replied to. Sent back out (with
  // `inReplyTo` appended) so the recipient's client keeps the reply in the same
  // conversation instead of starting a new one. Gmail-only; Graph builds its own
  // headers from the createReply draft.
  @IsOptional()
  @IsString()
  references?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  // When forwarding, the Gmail message id of the ORIGINAL message being forwarded.
  // Recorded server-side so the inbox can mark that message as forwarded.
  @IsOptional()
  @IsString()
  forwardedFrom?: string;

  // How much of the conversation the client quoted into `bodyHtml`. Only meaningful
  // alongside `forwardedFrom`, and only Microsoft acts on it: 'message' (the default)
  // lets Graph's createForward build the quote from the single original, while
  // 'thread' means the client already quoted every message itself, so the native
  // quote must be skipped or the newest message is forwarded twice.
  //
  // A string rather than a boolean on purpose: the send route is multipart/form-data
  // and the global pipe runs without `transform`, so a boolean would arrive as the
  // string "true" and fail @IsBoolean().
  @IsOptional()
  @IsIn(['message', 'thread'])
  forwardScope?: 'message' | 'thread';

  // When replying, the provider RESOURCE id of the message being replied to.
  // Distinct from `inReplyTo`, which carries the RFC 5322 Message-ID that Gmail
  // writes verbatim into the MIME headers. Microsoft needs the resource id
  // because Graph rejects `internetMessageHeaders` whose name doesn't start with
  // `x-` — In-Reply-To/References can only be produced by the createReply draft
  // flow. Ignored by GmailService, which threads via inReplyTo + threadId.
  @IsOptional()
  @IsString()
  replyToMessageId?: string;
}
