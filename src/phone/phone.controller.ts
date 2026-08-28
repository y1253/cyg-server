import {
  Body,
  Controller,
  Delete,
  Get,
  Req,
  Request,
  Sse,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
import { PhoneEventsService } from './phone-events.service.js';
import { sipCredentials } from './phone.config.js';
import { verifyQueryTokenUser } from '../communications/attachment-stream.util.js';
import { interval, map, merge, Observable, Subject, takeUntil } from 'rxjs';
import type { Request as ExpressRequest } from 'express';

/**
 * Shadows the DOM `MessageEvent`, which carries ~27 fields an SSE payload does not.
 * Same local declaration as `internal-messages.controller.ts`.
 */
interface MessageEvent {
  data: string;
}

/** Matches the internal-messages stream: nginx drops an idle SSE connection at 60s. */
const SSE_HEARTBEAT_MS = 25_000;

@Controller('phone')
export class PhoneController {
  constructor(
    private readonly provisioning: PhoneProvisioningService,
    private readonly events: PhoneEventsService,
  ) {}

  /**
   * The softphone's SIP credentials, for the AUTHENTICATED CALLER.
   *
   * This is what lets the app connect on load with no button and nothing typed.
   *
   * Every user currently gets the same shared credential — SIP passwords cannot be set
   * through any SignalWire API, so a credential per user would mean a manual dashboard
   * entry per user. The route is per-caller anyway so that swapping to per-user
   * credentials later changes only this method's body.
   *
   * Declared above `companies/:companyId/...`: Nest matches in declaration order and a
   * static segment must never sit below a parameterised sibling.
   */
  @Get('sip-credentials')
  @UseGuards(JwtAuthGuard)
  getSipCredentials() {
    const creds = sipCredentials(process.env);
    if (!creds) {
      // A null here means the softphone silently never rings, which is impossible to
      // tell apart from a quiet day — so name it.
      throw new ServiceUnavailableException(
        'Softphone is not configured on the server',
      );
    }
    return creds;
  }

  /**
   * The call ringing this user right now, or null.
   *
   * A NORMAL request, and deliberately so: it is the reliable way to learn which
   * company an INVITE belongs to. See PhoneEventsService.pending — a TLS-intercepting
   * content filter on the office network buffers streaming responses forever, so SSE
   * never delivers there while ordinary requests are unaffected. The client fetches
   * this the moment an INVITE arrives.
   */
  @Get('pending-call')
  @UseGuards(JwtAuthGuard)
  getPendingCall(@Request() req: { user: { userId: number } }) {
    return this.events.takePending(req.user.userId);
  }

  /**
   * Per-user push stream for incoming calls. EventSource cannot send headers, hence
   * `?token=`; the token is decoded to a user id rather than merely checked, because
   * this stream carries who is calling which company.
   *
   * MUST stay above any `:param` GET route — Nest matches in declaration order.
   */
  @Sse('events')
  streamEvents(
    @Query('token') token: string,
    @Req() req: ExpressRequest,
  ): Observable<MessageEvent> {
    const userId = verifyQueryTokenUser(token);

    const subject = new Subject<MessageEvent>();
    const clientId = `${userId}-${Date.now()}-${Math.random()}`;
    this.events.addClient(
      clientId,
      userId,
      subject as Subject<{ data: string }>,
    );

    const closed = new Subject<void>();
    req.on('close', () => {
      this.events.removeClient(clientId);
      closed.next();
      closed.complete();
    });

    // Nest writes nothing on an idle SSE stream, so a proxy closes it at its read
    // timeout. The client ignores `ping`.
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ data: JSON.stringify({ type: 'ping' }) })),
    );
    return merge(subject.asObservable(), heartbeat).pipe(takeUntil(closed));
  }

  /**
   * Search purchasable numbers. Admin only, because every call hits a paid provider.
   *
   * Declared above the `companies/:companyId/...` routes: Nest matches in declaration
   * order, and a static segment must never sit below a parameterised sibling.
   *
   * Query params are validated in the service rather than by a DTO — the global
   * ValidationPipe does not apply to individually injected @Query values, so a DTO here
   * would be decorative.
   */
  @Get('available')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  searchAvailable(
    @Query('country') country: string,
    @Query('areaCode') areaCode?: string,
  ) {
    return this.provisioning.searchAvailable(country, areaCode);
  }

  /**
   * The company's active support number, or null.
   *
   * Returns null rather than 404-ing, matching `GET /gmail/companies/:id/account`, so
   * the client hook needs no error branch for the ordinary "not connected yet" case.
   */
  @Get('companies/:companyId/number')
  @UseGuards(JwtAuthGuard)
  getNumber(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.provisioning.getActiveNumber(companyId);
  }

  /** Buy a number, point its webhooks at us, and attach it. Admin only. */
  @Post('companies/:companyId/number')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  attachNumber(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: AttachNumberDto,
  ) {
    return this.provisioning.attachNumber(
      companyId,
      dto.phoneNumber,
      dto.region,
    );
  }

  /** Release the number back to SignalWire. Permanent — billing stops. Admin only. */
  @Delete('companies/:companyId/number')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  releaseNumber(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.provisioning.releaseNumber(companyId);
  }
}
