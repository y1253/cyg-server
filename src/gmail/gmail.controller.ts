import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Headers,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Observable, Subject } from 'rxjs';
import type { Request, Response } from 'express';
import { GmailService } from './gmail.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';
import {
  buildGmailQuery,
  parseEmailSearchFilters,
  resolveScopeLabels,
} from '../communications/email-search.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import {
  OUTBOUND_MULTER_LIMITS,
  outboundAttachmentStorage,
  type OutboundFile,
} from '../communications/outbound-uploads.js';
// Shared with the Microsoft controller. These used to be private copies here,
// which is how the Content-Disposition header bug survived being fixed: later
// corrections to the shared versions (RFC 2231 filenames, suffix Range) never
// reached this route.
import {
  streamAttachment,
  verifyQueryToken,
  verifyQueryTokenUser,
} from '../communications/attachment-stream.util.js';

@Controller('gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(private readonly gmailService: GmailService) {}

  @Get('auth-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  getAuthUrl(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Req() req: Request & { user: { userId: number } },
  ) {
    return this.gmailService.generateAuthUrl(companyId, req.user.userId);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    try {
      await this.gmailService.handleCallback(code, state);
      res.redirect(`${frontendUrl}/gmail/success`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}/gmail/error?reason=${encodeURIComponent(reason)}`,
      );
    }
  }

  @Get('companies/:companyId/account')
  @UseGuards(JwtAuthGuard)
  getAccount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getAccount(companyId);
  }

  @Get('companies/:companyId/contacts')
  @UseGuards(JwtAuthGuard)
  getContacts(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getContacts(companyId);
  }

  @Get('companies/:companyId/chats')
  @UseGuards(JwtAuthGuard)
  getChats(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ) {
    return this.gmailService.getChats(companyId, cursor, q);
  }

  @Get('companies/:companyId/chat-thread')
  @UseGuards(JwtAuthGuard)
  getChatThread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('spaceId') spaceId: string,
    @Query('pageToken') pageToken?: string,
  ) {
    return this.gmailService.getChatThread(companyId, spaceId, pageToken);
  }

  @Patch('companies/:companyId/chats/read')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatRead(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.gmailService.markChatRead(companyId, body.messageId);
  }

  @Patch('companies/:companyId/chats/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.gmailService.markChatUnread(companyId, body.messageId);
  }

  // Chat message ids contain "/", so they're passed in the body (never a path param).
  @Patch('companies/:companyId/chats/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatComplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.gmailService.markComplete(companyId, body.messageId);
  }

  @Patch('companies/:companyId/chats/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatUncomplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.gmailService.markUncomplete(companyId, body.messageId);
  }

  @Get('companies/:companyId/unread-count')
  @UseGuards(JwtAuthGuard)
  getUnreadCount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getUnreadCount(companyId);
  }

  @Get('companies/:companyId/uncompleted-count')
  @UseGuards(JwtAuthGuard)
  getUncompletedCount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getUncompletedCount(companyId);
  }

  /** Uncompleted counts for every Gmail-connected company (dashboard badges). */
  @Get('uncompleted-counts')
  @UseGuards(JwtAuthGuard)
  getUncompletedCounts() {
    return this.gmailService.getUncompletedCounts();
  }

  @Get('companies/:companyId/emails')
  @UseGuards(JwtAuthGuard)
  getEmails(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('pageToken') pageToken?: string,
    @Query('labelIds') labelIds?: string,
    @Query('q') q?: string,
    // The advanced-search panel's fields, compiled here rather than on the client:
    // the two providers speak different query languages, and `getEmails` /
    // `getUncompletedEmailIds` both already forward `q` untouched.
    @Query() all?: Record<string, string | undefined>,
  ) {
    const filters = parseEmailSearchFilters(all ?? {});
    const search = buildGmailQuery(q, filters);
    const labels = resolveScopeLabels(
      labelIds ? labelIds.split(',') : undefined,
      filters?.scope,
    );
    return this.gmailService.getEmails(companyId, pageToken, labels, search);
  }

  // Full conversation thread. threadId is a query param (not a path segment)
  // to stay symmetric with the Microsoft provider, whose conversationId can
  // contain '/', '+' and '='.
  @Get('companies/:companyId/email-thread')
  @UseGuards(JwtAuthGuard)
  getEmailThread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('threadId') threadId: string,
  ) {
    return this.gmailService.getEmailThread(companyId, threadId);
  }

  @Get('companies/:companyId/emails/:messageId')
  @UseGuards(JwtAuthGuard)
  getEmail(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
    @Query('immutable') immutable?: string,
  ) {
    return this.gmailService.getEmail(companyId, messageId, immutable === '1');
  }

  // Download/stream a Gmail attachment. No guard — the JWT is passed as a query
  // param (verified manually) so the URL can be used directly as an <img>/<audio>/
  // <video> src and as an inline `cid:` image source inside the sandboxed iframe.
  @Get('companies/:companyId/emails/:messageId/attachments/:attachmentId')
  async getEmailAttachment(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('token') token: string,
    @Query('mimeType') mimeType: string,
    @Query('filename') filename: string,
    @Query('size') size: string,
    @Query('disposition') disposition: string,
    @Query('transcode') transcode: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    verifyQueryToken(token);
    // `filename`/`size` let the service re-resolve a superseded attachmentId. They are
    // already on the URL for the Content-Disposition header; passing them through is
    // what lets the client freeze the URL across refetches instead of rebuilding it
    // from an id Gmail rotates every threads.get. See lib/attachment-url.ts.
    const buf = await this.gmailService.getEmailAttachment(
      companyId,
      messageId,
      attachmentId,
      { filename, size: Number(size) || 0 },
    );
    const out = await this.maybeTranscode(buf, mimeType, filename, transcode);
    streamAttachment(
      res,
      out.buf,
      out.mimeType,
      out.filename,
      disposition,
      range,
    );
  }

  // Download/stream an uploaded Google Chat attachment. `resourceName` is a query
  // param (not a path segment) because it contains slashes. Same query-param JWT
  // auth as the email attachment route.
  @Get('companies/:companyId/chat-attachment')
  async getChatAttachment(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('token') token: string,
    @Query('resourceName') resourceName: string,
    @Query('mimeType') mimeType: string,
    @Query('filename') filename: string,
    @Query('disposition') disposition: string,
    @Query('transcode') transcode: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    verifyQueryToken(token);
    const buf = await this.gmailService.getChatAttachment(
      companyId,
      resourceName,
    );
    const out = await this.maybeTranscode(buf, mimeType, filename, transcode);
    streamAttachment(
      res,
      out.buf,
      out.mimeType,
      out.filename,
      disposition,
      range,
    );
  }

  // Optionally transcode audio to MP3 for the inline player (browsers can't decode
  // some chat voice codecs). Falls back to the original bytes if ffmpeg fails.
  private async maybeTranscode(
    buf: Buffer,
    mimeType: string,
    filename: string,
    transcode: string,
  ): Promise<{ buf: Buffer; mimeType: string; filename: string }> {
    if (transcode !== 'mp3') return { buf, mimeType, filename };
    try {
      const mp3 = await this.gmailService.transcodeAudioToMp3(buf);
      const base = (filename || 'audio').replace(/\.[^.]+$/, '');
      return { buf: mp3, mimeType: 'audio/mpeg', filename: `${base}.mp3` };
    } catch (err) {
      // The client asked for MP3 and is about to receive the original codec —
      // log loudly, otherwise the fallback looks like a client-side decode bug.
      this.logger.warn(
        `ffmpeg transcode failed for "${filename}" (${mimeType}); serving original bytes: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { buf, mimeType, filename };
    }
  }

  @Patch('companies/:companyId/emails/:messageId/read')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markAsRead(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.gmailService.markAsRead(companyId, messageId);
  }

  @Patch('companies/:companyId/emails/:messageId/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markAsUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.gmailService.markAsUnread(companyId, messageId);
  }

  // Gmail message ids have no "/", so they go in the path (mirrors read/unread).
  @Patch('companies/:companyId/emails/:messageId/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markEmailComplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.gmailService.markComplete(companyId, messageId);
  }

  @Patch('companies/:companyId/emails/:messageId/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markEmailUncomplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.gmailService.markUncomplete(companyId, messageId);
  }

  @Post('companies/:companyId/send')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    // Disk-staged, not in memory: the per-file cap is 250 MB, and anything that
    // doesn't fit inside the message is streamed to Drive from this temp copy.
    // The service deletes every staged file in a `finally`.
    // No maxCount: multer reads a non-numeric maxCount as Infinity, so the
    // number of attachments is unlimited. Total size still bounds the send.
    FilesInterceptor('attachments', undefined, {
      storage: outboundAttachmentStorage,
      limits: OUTBOUND_MULTER_LIMITS,
    }),
  )
  sendEmail(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendEmailDto,
    @UploadedFiles() attachments: OutboundFile[] = [],
  ) {
    return this.gmailService.sendEmail(companyId, dto, attachments);
  }

  @Post('companies/:companyId/chat-messages')
  @UseGuards(JwtAuthGuard)
  sendChatMessage(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.gmailService.sendChatMessage(companyId, dto);
  }

  @Delete('companies/:companyId/disconnect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.disconnect(companyId);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  handleWebhook(@Body() body: { message?: { data?: string } }) {
    void this.gmailService.handleWebhook(body);
  }

  @Sse('companies/:companyId/events')
  async streamEvents(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('token') token: string,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    // Validated by hand — no guard, since EventSource can't send headers. Decode WHO
    // the token belongs to and check the assignment: a valid signature alone let any
    // signed-in user subscribe to any company's mailbox stream.
    const userId = verifyQueryTokenUser(token);
    await this.gmailService.assertCanStream(companyId, userId);

    const subject = new Subject<MessageEvent>();
    const clientId = `${companyId}-${Date.now()}-${Math.random()}`;
    this.gmailService.addSseClient(
      clientId,
      companyId,
      subject as Subject<{ data: string }>,
    );

    req.on('close', () => {
      this.gmailService.removeSseClient(clientId);
    });

    return subject.asObservable();
  }
}
