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
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Observable, Subject } from 'rxjs';
import type { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { GmailService } from './gmail.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

// Only allow well-formed `type/subtype` mime strings through to the response
// header, to prevent header injection via the query param.
function sanitizeMime(mime: string | undefined): string {
  return mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime)
    ? mime
    : 'application/octet-stream';
}

// Strip characters that could break the Content-Disposition header (quotes,
// CR/LF, path separators).
function sanitizeFilename(name: string | undefined): string {
  return (name ?? 'attachment').replace(/["\r\n\\/]/g, '_').slice(0, 255);
}

function verifyQueryToken(token: string | undefined): void {
  try {
    jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
  } catch {
    throw new UnauthorizedException();
  }
}

// Stream attachment bytes with the right headers. Shared by the email + chat
// download routes. Honors HTTP Range requests (206 Partial Content) — required for
// reliable inline <audio>/<video> playback and seeking (media elements issue range
// requests; ignoring them makes some formats, e.g. .m4a, fail to play).
function streamAttachment(
  res: Response,
  buf: Buffer,
  mimeType: string | undefined,
  filename: string | undefined,
  disposition: string | undefined,
  range?: string,
): void {
  const dispositionType =
    disposition === 'attachment' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', sanitizeMime(mimeType));
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${sanitizeFilename(filename)}"`,
  );
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const total = buf.length;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }
    const chunk = buf.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', chunk.length);
    res.end(chunk);
    return;
  }

  res.setHeader('Content-Length', total);
  res.end(buf);
}

@Controller('gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(private readonly gmailService: GmailService) {}

  @Get('auth-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
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
  ) {
    const labels = labelIds ? labelIds.split(',') : undefined;
    return this.gmailService.getEmails(companyId, pageToken, labels, q);
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
  ) {
    return this.gmailService.getEmail(companyId, messageId);
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
    @Query('disposition') disposition: string,
    @Query('transcode') transcode: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    verifyQueryToken(token);
    const buf = await this.gmailService.getEmailAttachment(
      companyId,
      messageId,
      attachmentId,
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
    FilesInterceptor('attachments', 10, {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  sendEmail(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendEmailDto,
    @UploadedFiles()
    attachments: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }> = [],
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
  @Roles('ADMIN')
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
  streamEvents(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('token') token: string,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    // Validate JWT manually (no guard since EventSource can't send headers)
    try {
      jwt.verify(token, process.env.JWT_SECRET ?? 'secret');
    } catch {
      throw new Error('Unauthorized');
    }

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
