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
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { MicrosoftService } from './microsoft.service.js';
import { SendEmailDto } from '../gmail/dto/send-email.dto.js';
import { SendChatMessageDto } from '../gmail/dto/send-chat-message.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import {
  streamAttachment,
  transcodeAudioToMp3,
  verifyQueryToken,
} from '../communications/attachment-stream.util.js';

// Routes mirror the Gmail controller 1:1 (under global /api → `/api/microsoft/*`),
// minus SSE + Pub/Sub webhook (Microsoft relies on the tab's 15s polling instead).
@Controller('microsoft')
export class MicrosoftController {
  private readonly logger = new Logger(MicrosoftController.name);

  constructor(private readonly microsoft: MicrosoftService) {}

  @Get('auth-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getAuthUrl(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Req() req: Request & { user: { userId: number } },
    @Query('kind') kind?: string,
  ) {
    // `personal` → free/personal Outlook account (email only, no Teams scopes);
    // anything else → work/school account (full scopes incl. Teams).
    return this.microsoft.generateAuthUrl(
      companyId,
      req.user.userId,
      kind === 'personal' ? 'personal' : 'work',
    );
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    try {
      await this.microsoft.handleCallback(code, state);
      res.redirect(`${frontendUrl}/microsoft/success`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}/microsoft/error?reason=${encodeURIComponent(reason)}`,
      );
    }
  }

  @Get('companies/:companyId/account')
  @UseGuards(JwtAuthGuard)
  getAccount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.microsoft.getAccount(companyId);
  }

  @Get('companies/:companyId/contacts')
  @UseGuards(JwtAuthGuard)
  getContacts(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.microsoft.getContacts(companyId);
  }

  @Get('companies/:companyId/chats')
  @UseGuards(JwtAuthGuard)
  getChats(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.microsoft.getChats(companyId);
  }

  @Get('companies/:companyId/chat-thread')
  @UseGuards(JwtAuthGuard)
  getChatThread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('spaceId') spaceId: string,
    @Query('pageToken') pageToken?: string,
  ) {
    return this.microsoft.getChatThread(companyId, spaceId, pageToken);
  }

  @Patch('companies/:companyId/chats/read')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatRead(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.microsoft.markChatRead(companyId, body.messageId);
  }

  @Patch('companies/:companyId/chats/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.microsoft.markChatUnread(companyId, body.messageId);
  }

  @Patch('companies/:companyId/chats/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatComplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.microsoft.markComplete(companyId, body.messageId);
  }

  @Patch('companies/:companyId/chats/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatUncomplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { messageId: string },
  ) {
    return this.microsoft.markUncomplete(companyId, body.messageId);
  }

  @Get('companies/:companyId/unread-count')
  @UseGuards(JwtAuthGuard)
  getUnreadCount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.microsoft.getUnreadCount(companyId);
  }

  @Get('companies/:companyId/uncompleted-count')
  @UseGuards(JwtAuthGuard)
  getUncompletedCount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.microsoft.getUncompletedCount(companyId);
  }

  @Get('uncompleted-counts')
  @UseGuards(JwtAuthGuard)
  getUncompletedCounts() {
    return this.microsoft.getUncompletedCounts();
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
    return this.microsoft.getEmails(companyId, pageToken, labels, q);
  }

  // Full conversation thread. threadId is a query param (not a path segment)
  // because a Graph conversationId can contain '/', '+' and '='.
  @Get('companies/:companyId/email-thread')
  @UseGuards(JwtAuthGuard)
  getEmailThread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('threadId') threadId: string,
  ) {
    return this.microsoft.getEmailThread(companyId, threadId);
  }

  @Get('companies/:companyId/emails/:messageId')
  @UseGuards(JwtAuthGuard)
  getEmail(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
    @Query('immutable') immutable?: string,
  ) {
    return this.microsoft.getEmail(companyId, messageId, immutable === '1');
  }

  // No guard — the JWT is passed as a query param (verified manually) so the URL
  // works directly as an <img>/<audio>/<video> src and inline `cid:` image source.
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
    const buf = await this.microsoft.getEmailAttachment(
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

  // Chat (Teams) hosted-content download. `resourceName` is a query param (it has
  // slashes). Same query-param JWT auth as the email attachment route.
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
    const buf = await this.microsoft.getChatAttachment(companyId, resourceName);
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

  private async maybeTranscode(
    buf: Buffer,
    mimeType: string,
    filename: string,
    transcode: string,
  ): Promise<{ buf: Buffer; mimeType: string; filename: string }> {
    if (transcode !== 'mp3') return { buf, mimeType, filename };
    try {
      const mp3 = await transcodeAudioToMp3(buf);
      const base = (filename || 'audio').replace(/\.[^.]+$/, '');
      return { buf: mp3, mimeType: 'audio/mpeg', filename: `${base}.mp3` };
    } catch (err) {
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
    return this.microsoft.markAsRead(companyId, messageId);
  }

  @Patch('companies/:companyId/emails/:messageId/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markAsUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.microsoft.markAsUnread(companyId, messageId);
  }

  @Patch('companies/:companyId/emails/:messageId/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markEmailComplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.microsoft.markComplete(companyId, messageId);
  }

  @Patch('companies/:companyId/emails/:messageId/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markEmailUncomplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.microsoft.markUncomplete(companyId, messageId);
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
    return this.microsoft.sendEmail(companyId, dto, attachments);
  }

  @Post('companies/:companyId/chat-messages')
  @UseGuards(JwtAuthGuard)
  sendChatMessage(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.microsoft.sendChatMessage(companyId, dto);
  }

  @Delete('companies/:companyId/disconnect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.microsoft.disconnect(companyId);
  }
}
