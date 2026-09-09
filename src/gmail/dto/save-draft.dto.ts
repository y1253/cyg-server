import { IsIn, IsOptional, IsString } from 'class-validator';
import { IsEmailList } from './send-email.dto.js';

/**
 * The body of a draft save. Deliberately NOT a relaxed `SendEmailDto`.
 *
 * A draft is saved a couple of seconds after the user starts typing, which is long
 * before they have chosen a recipient — so `to` has to accept both "absent" and the
 * empty string. `SendEmailDto.to` stays `@IsEmailList()` and required, because a
 * *send* with no recipient is a genuine 400 and always was.
 *
 * `@IsEmailList({ allowEmpty: true })` is the one shared piece: a half-typed address
 * must still be rejected, or the draft write fails at the provider with an opaque
 * error instead of a validation message the composer can show. Empty is fine;
 * "bob@" is not.
 */
export class SaveDraftDto {
  @IsOptional()
  @IsEmailList({ allowEmpty: true })
  to?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  // Same reasoning as SendEmailDto.body: '' is safe everywhere downstream, a
  // *missing* field would reach `Buffer.from(undefined)` in the MIME builder.
  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsEmailList({ allowEmpty: true })
  cc?: string;

  @IsOptional()
  @IsEmailList({ allowEmpty: true })
  bcc?: string;

  @IsOptional()
  @IsString()
  inReplyTo?: string;

  @IsOptional()
  @IsString()
  references?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  @IsOptional()
  @IsString()
  forwardedFrom?: string;

  @IsOptional()
  @IsIn(['message', 'thread'])
  forwardScope?: 'message' | 'thread';

  // Graph only, and only on the FIRST save of a reply/forward draft: it names the
  // message to run createReply/createForward against. Ignored by Gmail, which
  // threads via inReplyTo + threadId in the raw MIME.
  @IsOptional()
  @IsString()
  replyToMessageId?: string;

  // Which Graph draft action produced this draft. Only read on create, and only by
  // MicrosoftService — it is what decides between createReply and createForward,
  // the sole way Graph will set In-Reply-To/References (see sendViaDraft).
  @IsOptional()
  @IsIn(['reply', 'forward'])
  draftKind?: 'reply' | 'forward';

  /**
   * "This draft has no attachments — don't go looking."
   *
   * Gmail's `drafts.update` REPLACES the whole message, so an update that rebuilt the
   * MIME from this DTO alone would delete any attachment the draft already had. The
   * server defends against that by re-reading the draft first — which costs a
   * `drafts.get` on every keystroke-pause, on mailboxes already near Gmail's rate
   * limit, to protect attachments that in the common case do not exist.
   *
   * The composer knows: it listed the draft's attachments when it opened it. So it
   * says so, and the server skips the read. ABSENT means "unknown", which keeps the
   * safe behaviour — a client that doesn't send this can never lose a file.
   *
   * A string, not a boolean: the create route is multipart/form-data and the global
   * pipe runs without `transform`, so a boolean arrives as "true" and fails
   * @IsBoolean(). Same reasoning as `forwardScope`.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  hasAttachments?: 'true' | 'false';

  /**
   * "The attachment parts in this request are the draft's complete new set."
   *
   * Without it, multer's empty `files` array cannot be told apart from a text-only
   * save — and guessing wrong in one direction silently deletes every attachment on
   * the draft, in the other silently keeps a file the user just removed.
   *
   * A string for the same reason as the others: multipart plus a non-transforming
   * pipe means a boolean arrives as "true".
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  setAttachments?: 'true' | 'false';
}
