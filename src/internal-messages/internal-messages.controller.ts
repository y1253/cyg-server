import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Request,
  Res,
  Sse,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request as ExpressRequest, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { interval, map, merge, Observable, Subject, takeUntil } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { parseEmailSearchFilters } from '../communications/email-search.js';
import { streamAttachmentFile } from '../communications/attachment-stream.util.js';
import {
  parseUserIdList,
  SendInternalMessageDto,
} from './dto/send-internal-message.dto.js';
import {
  Folder,
  InternalMessagesService,
  UploadedAttachment,
} from './internal-messages.service.js';
import {
  MESSAGE_MULTER_LIMITS,
  messageAttachmentStorage,
} from './uploads.js';

type AuthedRequest = { user: { userId: number; role: string } };

const FOLDERS: Folder[] = ['INBOX', 'UNCOMPLETED', 'UNREAD', 'SENT'];

interface MessageEvent {
  data: string;
}

/** Under any proxy read timeout worth worrying about (nginx defaults to 60s). */
const SSE_HEARTBEAT_MS = 25_000;

/**
 * Internal staff-to-staff messaging. Every route is JWT-only (no role gate) —
 * messaging is not an admin feature, mirroring how reply/send work in the Gmail
 * controller. Authorization is per-message and lives in the service.
 */
@Controller('internal-messages')
export class InternalMessagesController {
  constructor(private readonly service: InternalMessagesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @Request() req: AuthedRequest,
    @Query('folder') folder?: string,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    // The advanced-search panel's fields. Size and mail scope are email-only and
    // are simply ignored here — the panel hides them for this variant.
    @Query() all?: Record<string, string | undefined>,
  ) {
    const resolved = FOLDERS.includes(folder as Folder)
      ? (folder as Folder)
      : 'INBOX';
    const cursorId = cursor ? Number(cursor) : undefined;
    return this.service.list(
      req.user.userId,
      resolved,
      Number.isInteger(cursorId) && cursorId! > 0 ? cursorId : undefined,
      q,
      parseEmailSearchFilters(all ?? {}),
    );
  }

  @Get('uncompleted-count')
  @UseGuards(JwtAuthGuard)
  async uncompletedCount(@Request() req: AuthedRequest) {
    return { count: await this.service.getUncompletedCount(req.user.userId) };
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  async unreadCount(@Request() req: AuthedRequest) {
    return { count: await this.service.getUnreadCount(req.user.userId) };
  }

  /**
   * Full conversation. `threadId` is a query param for symmetry with the Gmail
   * controller's email-thread route.
   */
  @Get('thread')
  @UseGuards(JwtAuthGuard)
  thread(@Request() req: AuthedRequest, @Query('threadId') threadId?: string) {
    const id = Number(threadId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('threadId is required');
    }
    return this.service.getThread(id, req.user.userId);
  }

  /**
   * Attachment bytes. Deliberately UNGUARDED at the route level so the URL can be
   * used directly as an <img>/<audio>/<video> src (EventSource-style: the JWT
   * rides in the query string). The token is verified here and the decoded user
   * is then checked against the message in the service — a valid token for user A
   * cannot fetch user B's attachment.
   */
  @Get('attachments/:id')
  async attachment(
    @Param('id', ParseIntPipe) id: number,
    @Query('token') token: string,
    @Query('disposition') disposition: string,
    @Req() req: ExpressRequest,
    @Res() res: Response,
  ) {
    const viewerId = verifyQueryTokenUser(token);
    const attachment = await this.service.getAttachment(id, viewerId);
    await streamAttachmentFile(
      res,
      attachment.absolutePath,
      attachment.mimeType,
      attachment.filename,
      disposition,
      req.headers.range,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  // No maxCount — internal messages take any number of files, matching outbound
  // email. Only the per-file ceiling in MESSAGE_MULTER_LIMITS applies.
  @UseInterceptors(
    FilesInterceptor('attachments', undefined, {
      storage: messageAttachmentStorage,
      limits: MESSAGE_MULTER_LIMITS,
    }),
  )
  send(
    @Request() req: AuthedRequest,
    // Multipart text fields are populated into the body by multer, so @Body still
    // runs the global ValidationPipe over them. They arrive as strings (the pipe
    // has no `transform`), hence the comma-separated id lists.
    @Body() dto: SendInternalMessageDto,
    @UploadedFiles() files: UploadedAttachment[] | undefined,
  ) {
    const parentId = dto.parentId ? Number(dto.parentId) : undefined;
    return this.service.send(
      req.user.userId,
      {
        to: parseUserIdList(dto.to),
        cc: parseUserIdList(dto.cc),
        bcc: parseUserIdList(dto.bcc),
        subject: dto.subject,
        body: dto.body,
        bodyHtml: dto.bodyHtml,
        parentId:
          Number.isInteger(parentId) && parentId! > 0 ? parentId : undefined,
        isForward: dto.isForward === '1' || dto.isForward === 'true',
      },
      files ?? [],
    );
  }

  /**
   * Per-user push stream. EventSource can't send headers, hence the ?token=.
   *
   * MUST stay above `@Get(':id')` — Nest matches routes in declaration order and
   * an SSE route is a GET, so `/events` would otherwise be swallowed by the
   * numeric-id handler.
   */
  @Sse('events')
  streamEvents(
    @Query('token') token: string,
    @Req() req: ExpressRequest,
  ): Observable<MessageEvent> {
    const userId = verifyQueryTokenUser(token);

    const subject = new Subject<MessageEvent>();
    const clientId = `${userId}-${Date.now()}-${Math.random()}`;
    this.service.addSseClient(
      clientId,
      userId,
      subject as Subject<{ data: string }>,
    );

    const closed = new Subject<void>();
    req.on('close', () => {
      this.service.removeSseClient(clientId);
      closed.next();
      closed.complete();
    });

    // Nest writes nothing on an idle SSE stream, so a reverse proxy drops the
    // connection at its read timeout (nginx defaults to 60s) and the browser has to
    // reconnect. This keeps it warm; the client ignores `ping`. `takeUntil(closed)`
    // is what stops the interval — otherwise the timer would outlive the request.
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ data: JSON.stringify({ type: 'ping' }) })),
    );

    return merge(subject.asObservable(), heartbeat).pipe(takeUntil(closed));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthedRequest) {
    return this.service.getOne(id, req.user.userId);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  markRead(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthedRequest,
  ) {
    return this.service.markRead(id, req.user.userId);
  }

  @Patch(':id/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  markUnread(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthedRequest,
  ) {
    return this.service.markUnread(id, req.user.userId);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  markComplete(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthedRequest,
  ) {
    return this.service.markComplete(id, req.user.userId);
  }

  @Patch(':id/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  markUncomplete(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthedRequest,
  ) {
    return this.service.markUncomplete(id, req.user.userId);
  }
}

/**
 * Verify a JWT passed as a query param and return WHO it belongs to.
 *
 * The shared `verifyQueryToken` in attachment-stream.util.ts only checks that a
 * token is well-formed — fine for the provider controllers where the resource is
 * already scoped by companyId in the path, but not here: internal attachments are
 * per-user, so we need the subject to authorize against.
 */
function verifyQueryTokenUser(token: string | undefined): number {
  try {
    const payload = jwt.verify(
      token ?? '',
      process.env.JWT_SECRET ?? 'secret',
    ) as { sub?: number | string };
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('bad subject');
    }
    return userId;
  } catch {
    throw new UnauthorizedException();
  }
}
