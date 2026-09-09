import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  INTERNAL_CALL_FOLDERS,
  InternalCallsService,
  type InternalCallFolder,
} from './internal-calls.service.js';
import { StartInternalCallDto } from './dto/start-internal-call.dto.js';
import { TransferCallDto } from '../phone/dto/transfer-call.dto.js';

type AuthedRequest = { user: { userId: number } };

/**
 * Staff-to-staff calling, inside the "Cyg Finance" internal workspace.
 *
 * Every route is scoped to the CALLER, never to a company id in the path — an internal
 * call belongs to two people, not to a company. That is the structural difference from
 * `/phone/companies/:companyId/...`, and it is why authorization lives in the service as
 * a participant check rather than in `assertMayUseCompanyPhone`.
 */
@Controller('internal-calls')
@UseGuards(JwtAuthGuard)
export class InternalCallsController {
  constructor(private readonly service: InternalCallsService) {}

  /**
   * The caller's call history, one keyset page at a time.
   *
   * `folder` is whitelisted rather than cast, exactly as the internal-messages controller
   * does it -- the value reaches a Prisma `where` and an unchecked string there is how a
   * query builder starts taking instructions from the query string.
   */
  @Get()
  list(
    @Request() req: AuthedRequest,
    @Query('folder') folder?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);
    const parsedCursor = Number(cursor);
    return this.service.list(
      req.user.userId,
      INTERNAL_CALL_FOLDERS.includes(folder as InternalCallFolder)
        ? (folder as InternalCallFolder)
        : 'INBOX',
      Number.isInteger(parsedCursor) && parsedCursor > 0
        ? parsedCursor
        : undefined,
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : undefined,
    );
  }

  /**
   * Unread / uncompleted totals for the workspace folder chips.
   *
   * Static, so it MUST stay above the `:sid` routes below -- Nest matches in declaration
   * order and `/counts` would otherwise be read as a call sid.
   */
  @Get('counts')
  counts(@Request() req: AuthedRequest) {
    return this.service.counts(req.user.userId);
  }

  /**
   * Declared ABOVE nothing parameterised today, but kept static-first by habit: Nest
   * matches in declaration order and this controller will grow.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  start(@Request() req: AuthedRequest, @Body() dto: StartInternalCallDto) {
    return this.service.startCall(req.user.userId, dto.calleeId);
  }

  /**
   * Hand this staff-to-staff call to a third colleague and drop out.
   *
   * Participants only — see `transferBlind`. Declared beside the other `:sid` routes;
   * it is a POST on a distinct path, so it cannot shadow the GET above it.
   */
  @Post(':sid/transfer/blind')
  @HttpCode(HttpStatus.OK)
  transferBlind(
    @Param('sid') sid: string,
    @Body() dto: TransferCallDto,
    @Request() req: { user: { userId: number } },
  ) {
    return this.service.transferBlind(req.user.userId, sid, dto.targetUserId);
  }

  /**
   * "Has my colleague picked up yet?" after a transfer — participants only, like every
   * other `:sid` route here. `sid` is the ROOT sid, which is the only one
   * `assertParticipant` can look up: `InternalCall.callSid` records the root, so the
   * transferred leg would 404 on exactly the half of transfers where the requester was
   * the caller.
   */
  @Get(':sid/transfer-status')
  transferStatus(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.transferStatus(req.user.userId, sid);
  }

  @Get(':sid/recordings')
  recordings(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.recordings(req.user.userId, sid);
  }

  /**
   * Read / completed state, mirroring the four internal-message routes: 204, empty body,
   * one verb per path rather than an action in the payload.
   *
   * Participants only (`assertParticipant` inside), and a no-op for the caller -- a call
   * you placed already projects as read and completed.
   */
  @Patch(':sid/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.setState(req.user.userId, sid, 'read');
  }

  @Patch(':sid/unread')
  @HttpCode(HttpStatus.NO_CONTENT)
  markUnread(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.setState(req.user.userId, sid, 'unread');
  }

  @Patch(':sid/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  markComplete(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.setState(req.user.userId, sid, 'complete');
  }

  @Patch(':sid/uncomplete')
  @HttpCode(HttpStatus.NO_CONTENT)
  markUncomplete(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.setState(req.user.userId, sid, 'uncomplete');
  }
}
