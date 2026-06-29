import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { GmailService } from './gmail.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('gmail')
export class GmailController {
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
      res.redirect(`${frontendUrl}/gmail/error?reason=${encodeURIComponent(reason)}`);
    }
  }

  @Get('companies/:companyId/account')
  @UseGuards(JwtAuthGuard)
  getAccount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getAccount(companyId);
  }

  @Get('companies/:companyId/chats')
  @UseGuards(JwtAuthGuard)
  getChats(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getChats(companyId);
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
    @Body() body: { spaceId: string },
  ) {
    return this.gmailService.markChatRead(companyId, body.spaceId);
  }

  @Patch('companies/:companyId/chats/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  markChatUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() body: { spaceId: string },
  ) {
    return this.gmailService.markChatUnread(companyId, body.spaceId);
  }

  @Get('companies/:companyId/unread-count')
  @UseGuards(JwtAuthGuard)
  getUnreadCount(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.gmailService.getUnreadCount(companyId);
  }

  @Get('companies/:companyId/emails')
  @UseGuards(JwtAuthGuard)
  getEmails(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('pageToken') pageToken?: string,
    @Query('labelIds') labelIds?: string,
  ) {
    const labels = labelIds ? labelIds.split(',') : undefined;
    return this.gmailService.getEmails(companyId, pageToken, labels);
  }

  @Get('companies/:companyId/emails/:messageId')
  @UseGuards(JwtAuthGuard)
  getEmail(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
  ) {
    return this.gmailService.getEmail(companyId, messageId);
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

  @Post('companies/:companyId/send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  sendEmail(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendEmailDto,
  ) {
    return this.gmailService.sendEmail(companyId, dto);
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
    this.gmailService.addSseClient(clientId, companyId, subject as Subject<{ data: string }>);

    req.on('close', () => {
      this.gmailService.removeSseClient(clientId);
    });

    return subject.asObservable();
  }
}
