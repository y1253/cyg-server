import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RealtimeService } from './realtime.service.js';
import type { RealtimeBatch } from './realtime.types.js';

type AuthedRequest = { user: { userId: number } };

/**
 * The browser's end of the real-time channel.
 *
 * ── WHY A LONG POLL AND NOT SSE ────────────────────────────────────────────────
 * There are already three `@Sse` streams in this server and they do not work on the
 * network this firm uses: a TLS-intercepting content filter buffers a response until it
 * completes, so a stream never delivers its headers at all (verified — normal API 200 in
 * 76ms, both streams hung indefinitely). A long poll completes, so it is forwarded.
 *
 * ⚠️ Authenticated by the ORDINARY `JwtAuthGuard`, not `verifyQueryTokenUser`. That
 * helper exists because `EventSource` cannot set headers; this is a plain `fetch`, so the
 * `Authorization` header works and no JWT ever lands in a URL, a log or a Referer.
 */
@Controller('realtime')
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * `since` is the `seq` from the previous answer; `0` (or absent) means "just tell me
   * the cursor". Anything unparseable is treated as `0` rather than 400: a client that
   * cannot resync is worse than one that resyncs from scratch.
   */
  @Get('events')
  events(
    @Request() req: AuthedRequest,
    @Query('since') since?: string,
  ): Promise<RealtimeBatch> {
    const parsed = Number.parseInt(since ?? '0', 10);
    const cursor = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    return this.realtime.wait(req.user.userId, cursor);
  }
}
