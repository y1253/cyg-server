import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { InternalCallsService } from './internal-calls.service.js';
import { StartInternalCallDto } from './dto/start-internal-call.dto.js';

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

  @Get()
  list(@Request() req: AuthedRequest, @Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.service.list(
      req.user.userId,
      Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
    );
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

  @Get(':sid/recordings')
  recordings(@Request() req: AuthedRequest, @Param('sid') sid: string) {
    return this.service.recordings(req.user.userId, sid);
  }
}
