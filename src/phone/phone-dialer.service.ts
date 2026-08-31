import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertMayUseCompanyPhone } from './company-phone-access.util.js';
import { SignalWireService } from './signalwire.service.js';
import { PhoneEventsService } from './phone-events.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { recordMode, sipDialTarget, webhookUrls } from './phone.config.js';
import { dialNumber } from './laml.util.js';
import { isE164 } from './signalwire-parse.js';

/**
 * Placing a call from the browser.
 *
 * ── WHY THIS IS A REST CALL AND NOT A BROWSER INVITE ───────────────────────────
 * Every browser registers the SAME shared SIP credential, because SIP passwords cannot
 * be set through any SignalWire API and per-user credentials would mean a manual
 * dashboard entry per user. A browser-originated INVITE would therefore have to be
 * routed by the SIP endpoint's own `call_handler`, which is dashboard configuration we
 * have specifically committed to not needing.
 *
 * So instead the server asks SignalWire to call US first — `To` is the shared SIP
 * credential — and hands it the `<Dial>` for the customer inline. The agent's browser
 * rings, and on answer SignalWire dials the customer showing the company's number.
 *
 * The payoff is that the call arrives at the browser as an ordinary INVITE, so the
 * existing pairing logic in `SoftphoneContext` handles it with no changes at all.
 *
 * ── WHY THE LaML IS INLINE ─────────────────────────────────────────────────────
 * `POST /Calls` accepts a `Laml` parameter, so no publicly reachable callback URL is
 * needed. That is worth more than the saved round-trip: a `Url` webhook would have to
 * carry the customer's number, and webhook signatures here are computed over the exact
 * URL including its query string — making the signed value depend on parameter order
 * and encoding. Two deploy cycles have already been lost to signature mistakes in this
 * module. The safest webhook is the one that does not exist.
 */
@Injectable()
export class PhoneDialerService {
  private readonly logger = new Logger(PhoneDialerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
    private readonly events: PhoneEventsService,
    private readonly timeline: PhoneTimelineService,
  ) {}

  /** Seconds the agent's browser rings before SignalWire gives up. */
  private static readonly RING_TIMEOUT = 30;

  async startCall(
    companyId: number,
    to: string,
    userId: number,
  ): Promise<{ callSid: string; to: string; companyName: string }> {
    if (!isE164(to)) {
      throw new BadRequestException('to must be an E.164 number');
    }

    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    // Placing a call spends money AND speaks with the company's identity, so plain
    // authentication is not the right bar: the caller must actually work this company,
    // or be an admin. Deliberately stricter than the read routes beside it.
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      userId,
      company.businessName,
      'dial out',
    );

    const number = await this.prisma.supportNumber.findFirst({
      where: { companyId, releasedAt: null },
      orderBy: { id: 'desc' },
      select: { phoneNumber: true },
    });
    if (!number) {
      throw new NotFoundException('This company has no support number');
    }
    if (to === number.phoneNumber) {
      // SignalWire would happily bridge this into a loop billed both ways.
      throw new BadRequestException('Cannot call the company’s own number');
    }

    const sipTarget = sipDialTarget(process.env);
    if (!sipTarget) {
      // Named, rather than a mysterious failure: an unset SIP config means no browser
      // can ever be rung, which is indistinguishable from "nobody answered".
      this.logger.error(
        'SIGNALWIRE_SIP_* is not configured — no browser can be rung',
      );
      throw new ServiceUnavailableException(
        'Softphone is not configured on the server',
      );
    }

    const laml = dialNumber(to, {
      callerId: number.phoneNumber,
      timeout: PhoneDialerService.RING_TIMEOUT,
      record: recordMode(process.env),
    });

    const call = await this.signalwire.createCall({
      to: `sip:${sipTarget}`,
      from: number.phoneNumber,
      laml,
      statusCallback: webhookUrls(process.env).statusCallback,
      timeoutSec: PhoneDialerService.RING_TIMEOUT,
    });

    this.logger.log(
      `outbound call ${number.phoneNumber} -> ${to} for ${company.businessName} ` +
        `by user ${userId} sid=${call.sid}`,
    );

    // Tell only the initiating user's browser. Every registered browser will receive
    // the INVITE — they all share one credential — but only the one that asked for
    // this call should show it, exactly as with an inbound call's routing.
    this.events.broadcastOutgoingCall(userId, {
      type: 'outgoing-call',
      direction: 'outbound',
      companyId,
      companyName: company.businessName,
      from: number.phoneNumber,
      to,
      callSid: call.sid,
      at: Date.now(),
    });

    // The new call will not appear in a window fetched a moment ago.
    this.timeline.bust(companyId);

    return { callSid: call.sid, to, companyName: company.businessName };
  }

}
