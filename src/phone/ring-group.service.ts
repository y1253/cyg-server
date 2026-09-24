import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from './signalwire.service.js';
import { conferenceRoomFor } from './call-legs.util.js';
import {
  conferenceVerb,
  hangup,
  hangupVerb,
  response,
  sayVerb,
} from './laml.util.js';
import { whisperDoc } from './call-screen.util.js';
import { recordMode, webhookUrls } from './phone.config.js';
import { PRE_ANSWER } from './phone-timeline.util.js';

/**
 * Ringing the assigned staff member's own mobile at the same time as their browser.
 *
 * ── WHY THIS IS NOT A <Dial> NOUN, AND NOT ConferenceService EITHER ─────────────
 * `scripts/signalwire-number-noun-probe.mjs` proved on the live account that a `<Dial>`
 * honours only its FIRST noun: `<Sip>` + `<Number>` creates only the `<Sip>` leg, silently,
 * with no error and nothing in any log. So the mobile cannot be a second noun.
 *
 * `ConferenceService` is the other near-miss. Its `beginConference` opens with "This call
 * has not connected yet, so there is nobody to add to" — add-call assumes two legs ALREADY
 * TALKING, which is the exact opposite of a ring group.
 *
 * ── THE SHAPE, AND WHY THE BROWSER PATH IS UNTOUCHED ────────────────────────────
 * The caller keeps TODAY'S document — `<Dial action record><Sip X-Cyg-Leg=…/></Dial>` — and
 * the mobile is dialled CONCURRENTLY as its own `createCall`. Both ring at once; first to
 * answer wins.
 *
 * That asymmetry is the whole design, and it is worth stating why the symmetric version was
 * rejected. Putting the CALLER into a conference at ring time (so both candidates join it)
 * reads better on a diagram and breaks the call: `classifyLegs` resolves the agent as the
 * `<Dial>` CHILD of the root, and a participant created by `createCall` is its own root and
 * a child of nothing. Blind transfer, add-call, hold music, the dial pad and "End &
 * complete" all go through `legsFor`, so every one of them would stop working for the whole
 * call — including the overwhelmingly common case where a browser is what answered.
 *
 * So a conference is formed ONLY when the mobile wins, which is exactly the case where those
 * browser features have nobody to act for: the agent is on their cell.
 *
 * | who answers | what the call is                  | in-call features        |
 * |-------------|-----------------------------------|-------------------------|
 * | browser     | an ordinary `<Dial><Sip>` bridge  | all work, unchanged     |
 * | mobile      | caller + mobile in a conference   | N/A — nobody at a browser |
 * | nobody      | `<Dial>` times out → `voice/dial-status` → company voicemail | unchanged |
 *
 * ⚠️ Every method here is BEST-EFFORT and none of them throws. This runs beside a live
 * inbound call whose `<Dial>` has already been handed to SignalWire: a failure must cost the
 * mobile leg, never the call. `autoProvisionForCompany` states the same rule for the same
 * reason.
 */

/** One mobile we rang, and who it belongs to. */
interface RingLeg {
  legSid: string;
  userId: number;
  e164: string;
}

interface RingGroupRecord {
  callSid: string;
  companyId: number;
  companyName: string;
  supportNumber: string;
  room: string;
  legs: RingLeg[];
  /**
   * Who got there first, or null while everything is still ringing.
   *
   * ⚠️ Written SYNCHRONOUSLY before any provider call — the `ActiveCallsService.claim`
   * rule. The browser's `/answered` POST and a keypress on a handset genuinely can land
   * together, and the loser of that race has to be told the call is gone rather than
   * bridged into a conversation somebody else is already having.
   */
  answeredBy: 'browser' | 'mobile' | null;
  voice?: string;
  at: number;
}

@Injectable()
export class RingGroupService {
  private readonly logger = new Logger(RingGroupService.name);

  /**
   * Bounds a leaked record only. A ring group lives for one ring — `ringTimeoutSeconds`
   * plus the whisper — so anything older than this never had an ending reported.
   */
  private static readonly TTL_MS = 10 * 60 * 1000;

  /** How often we ask whether the caller's `<Dial>` has started. See `waitForDialChild`. */
  private static readonly CHILD_POLL_MS = 1_500;

  /**
   * Longest we will wait for a greeting to finish before giving up on the call entirely.
   *
   * Generous rather than tight: a company may record a long greeting, and the cost of
   * waiting is nothing (the browser is not ringing yet either). What it bounds is a call
   * whose `<Dial>` never runs at all.
   */
  private static readonly MAX_GREETING_WAIT_MS = 45_000;

  /** Keyed by the CALLER's inbound sid, which is what every webhook here can name. */
  private readonly groups = new Map<string, RingGroupRecord>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
  ) {}

  /**
   * Ring every assigned mobile, alongside the `<Dial>` the caller is already executing.
   *
   * Fire-and-forget by design: `voiceInbound` must return its LaML at once or the caller
   * hears nothing while we talk to SignalWire. The browsers are already ringing by the time
   * the first `createCall` resolves.
   */
  async start(input: {
    callSid: string;
    companyId: number;
    companyName: string;
    supportNumber: string;
    from: string;
    fromName: string | null;
    phones: { userId: number; e164: string }[];
    ringTimeoutSeconds: number;
    voice?: string;
    /**
     * Is the caller hearing a greeting before their `<Dial>` runs?
     *
     * Passed down rather than re-derived: the controller already knows, and it is one of
     * THREE texts (greeting, after-hours message, or null), which this service has no
     * business re-deciding.
     */
    hasGreeting: boolean;
  }): Promise<void> {
    this.sweep();
    if (!input.phones.length) return;

    /**
     * ⚠️ ONE ring group per call, ever.
     *
     * `voice/inbound` can be requested more than once for a single CallSid — observed in
     * production, twice nineteen seconds apart, producing two legs to the same handset
     * seven seconds apart. The second `start()` used to overwrite `groups[callSid]`, which
     * ORPHANS the first record: `browserAnswered` and `screenAccept` both find the call
     * through this map, so the first record's legs became unreachable and rang out their
     * full timeout with nothing in the system able to cancel them.
     *
     * Returning early rather than replacing is what keeps the legs cancellable. A record
     * for this sid means the ring group is already running, or has already run.
     */
    if (this.groups.has(input.callSid)) {
      this.logger.log(
        `ring-group ${input.callSid} already started — ignoring a repeat inbound webhook`,
      );
      return;
    }

    const record: RingGroupRecord = {
      callSid: input.callSid,
      companyId: input.companyId,
      companyName: input.companyName,
      supportNumber: input.supportNumber,
      room: conferenceRoomFor(input.callSid),
      legs: [],
      answeredBy: null,
      voice: input.voice,
      at: Date.now(),
    };
    // Registered BEFORE the first provider call: a keypress can arrive while we are still
    // dialling the second mobile, and `screenAccept` can only find its record through here.
    this.groups.set(input.callSid, record);

    /**
     * ── WAIT FOR THE GREETING, SO BOTH REALLY DO RING TOGETHER ──────────────────
     *
     * The caller's LaML runs in document order — `<Say>greeting</Say>` then `<Dial>` — so
     * the browser does not ring until the greeting ends, while this method runs the moment
     * the webhook is handled. Dialling now rings the staff member's cell several seconds
     * before their screen, which is what "in parallel" must NOT mean.
     *
     * The APPEARANCE of the `<Dial>` child leg IS the browser starting to ring, so waiting
     * for it makes the two simultaneous by construction rather than by arithmetic. That
     * matters because a greeting's length is unknowable here: CLAUDE.md already records it
     * as "unknown and unbounded", and answered that with wider TTLs rather than a guess.
     */
    if (input.hasGreeting && !(await this.waitForDialChild(input.callSid))) {
      this.logger.log(
        `ring-group ${input.callSid} not dialling — the caller's <Dial> never started`,
      );
      return;
    }

    /**
     * ⚠️ A browser can answer DURING the wait, and `browserAnswered` can only end legs that
     * already exist — it cannot cancel one that has not been created. Without this the cell
     * would start ringing just after somebody picked the call up.
     */
    if (record.answeredBy) {
      this.logger.log(
        `ring-group ${input.callSid} answered during the greeting — no mobile dialled`,
      );
      return;
    }

    const laml = whisperDoc({
      companyName: input.companyName,
      from: input.from,
      fromName: input.fromName,
      action: webhookUrls(process.env).screenAcceptUrl,
      voice: input.voice,
    });

    await Promise.all(
      input.phones.map(async (phone) => {
        try {
          const call = await this.signalwire.createCall({
            to: phone.e164,
            // ⚠️ The company's OWN support number, which is what the handset displays.
            // Every client company has its own, so it names which line is ringing.
            //
            // It cannot be the CUSTOMER's number: `POST /Calls` requires a `From` this
            // account owns, and anything else is caller-ID spoofing that SignalWire rejects
            // and STIR/SHAKEN would flag as spam. The customer's number reaches the staff
            // member in the whisper instead, read out digit by digit.
            //
            // The cost of that choice is `from === supportNumber`, which is precisely what
            // `counterpartyOfCall` reads as an outbound call — `staffNumbers` in
            // `phone-timeline.util.ts` is what keeps this leg off the client's timeline.
            from: input.supportNumber,
            laml,
            statusCallback: webhookUrls(process.env).statusCallback,
            timeoutSec: input.ringTimeoutSeconds,
          });
          record.legs.push({
            legSid: call.sid,
            userId: phone.userId,
            e164: phone.e164,
          });

          /**
           * ⚠️ The leg is only cancellable once it is IN the list, and `createCall` takes a
           * round trip to answer. A `browserAnswered` landing inside that window ran
           * `cancelLegs` against an empty list, returned at its own `if (!targets.length)`,
           * and never looked again — so the handset rang out its full timeout with
           * `answeredBy` already set to 'browser'.
           *
           * The re-check before the loop guards the GREETING wait, which is a different
           * window. This one closes the gap between asking for the leg and being told its
           * sid.
           */
          if (record.answeredBy) {
            this.logger.log(
              `ring-group ${input.callSid} was answered while ${phone.e164} was being ` +
                'dialled — cancelling it',
            );
            await this.cancelLegs(record, null);
          }
        } catch (err) {
          // One unreachable mobile must not cost the others, nor the call.
          this.logger.error(
            `ring-group ${input.callSid} could not dial ${phone.e164}: ${String(err)}`,
          );
        }
      }),
    );

    this.logger.log(
      `ring-group ${input.companyName} (${input.callSid}) -> mobiles [` +
        `${record.legs.map((l) => l.e164).join(', ')}]`,
    );
  }

  /**
   * A browser picked the call up, so stop ringing the mobiles.
   *
   * Driven by the `/answered` route the softphone already posts. Best-effort on purpose: if
   * it never arrives the mobiles simply ring out their own `timeoutSec`, which is untidy and
   * harmless, and `screenAccept` still refuses to bridge a call that is already gone.
   */
  async browserAnswered(callSid: string): Promise<void> {
    const record = this.groups.get(callSid);
    if (!record || record.answeredBy) return;
    record.answeredBy = 'browser';
    this.logger.log(
      `ring-group ${callSid} answered in a browser — cancelling mobiles`,
    );
    await this.cancelLegs(record, null);
  }

  /**
   * The whisper's keypress. Returns the document that mobile leg runs next.
   *
   * ⚠️ Accepting a call a browser has already taken must HANG UP, not bridge. The race is
   * real — somebody reaching for their cell as a colleague clicks Answer — and bridging here
   * would drop a second member of staff into a conversation already in progress.
   */
  async screenAccept(legSid: string, digits: string): Promise<string> {
    const found = this.findByLeg(legSid);
    if (!found) {
      // The record is gone (a restart, or the TTL). Nothing can be bridged, and saying so
      // is better than dead air on a handset somebody just answered.
      return this.spoken('Sorry, that call is no longer available. Goodbye.');
    }
    const { record, leg } = found;

    if (digits !== '1') {
      // NOT the reject path. `<Gather>` only requests its action when digits ARRIVE, so
      // silence never reaches here at all — it falls through to the `<Hangup/>` sitting
      // after the `<Gather>`. This is somebody pressing the wrong key.
      return hangup();
    }
    if (record.answeredBy) {
      return this.spoken(
        'That call has already been answered. Goodbye.',
        record.voice,
      );
    }

    record.answeredBy = 'mobile';
    this.logger.log(
      `ring-group ${record.callSid} accepted on ${leg.e164} (user ${leg.userId})`,
    );

    // Order matters, and this is the one place the design forms a conference.
    //
    // The CALLER is moved first. Redirecting them replaces their document, which ends the
    // `<Dial>` and with it the browsers' leg — so the browsers stop ringing as a consequence
    // of the move rather than of a second request that could fail on its own. This is
    // `blindTransfer`'s mechanic, which redirects a live leg in production every day.
    await this.moveCallerToRoom(record);
    await this.markAnsweredOnMobile(record, leg);
    await this.cancelLegs(record, leg.legSid);

    return response(
      conferenceVerb(record.room, {
        // The staff member arrives into a room the caller is already waiting in, so they
        // are the one who starts it.
        startOnEnter: true,
        // `endOnExit` for BOTH parties: there are only ever two in this room, and either
        // one hanging up should end the call. That is the "mobile-phone model"
        // `conferenceDoc` describes — it needs no server call, so it still holds if our
        // process is down.
        endOnExit: true,
        // No beep. This is an ordinary 1:1 call that merely happens to be built out of a
        // room; a tone on entry is a change the customer can hear.
        beep: 'false',
      }),
    );
  }

  /** Clean up once the call is over, whoever took it. */
  forget(callSid: string): void {
    this.groups.delete(callSid);
  }

  /** Is this inbound call one we also rang mobiles for? */
  has(callSid: string): boolean {
    return this.groups.has(callSid);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * Put the caller into the room, carrying their recording with them.
   *
   * ⚠️ `record` is RE-ATTACHED. A redirect drops every attribute the previous `<Dial>`
   * carried, so omitting it here silently stops the recording and the AI summary — the rule
   * `conferenceDoc` and `blindTransfer` both state in their own words.
   *
   * `endOnExit: true` here as well: if the CUSTOMER hangs up first the room ends, rather
   * than leaving the staff member sitting in an empty conference.
   */
  private async moveCallerToRoom(record: RingGroupRecord): Promise<void> {
    try {
      await this.signalwire.updateCall(record.callSid, {
        laml: response(
          conferenceVerb(
            record.room,
            { startOnEnter: false, endOnExit: true, beep: 'false' },
            { record: recordMode(process.env) },
          ),
        ),
      });
    } catch (err) {
      this.logger.error(
        `ring-group ${record.callSid} could not move the caller into ` +
          `${record.room}: ${String(err)}`,
      );
    }
  }

  /**
   * Record that this call was answered away from any browser.
   *
   * ⚠️ This row is not bookkeeping — it is what stops the call reporting MISSED. By the
   * time the timeline sees it the caller's SIP child is terminal, and `callOutcome` reads
   * that child as the truth, so without this the one case the whole feature exists for would
   * be filed as a call nobody took. See `answeredOffBrowser` in `phone-timeline.util.ts`.
   */
  private async markAnsweredOnMobile(
    record: RingGroupRecord,
    leg: RingLeg,
  ): Promise<void> {
    try {
      await this.prisma.ringGroupAnswer.upsert({
        where: { callSid: record.callSid },
        create: {
          callSid: record.callSid,
          companyId: record.companyId,
          answeredByUserId: leg.userId,
          answeredOn: leg.e164,
        },
        update: {},
      });
    } catch (err) {
      // A history row must never cost a live call — the ordering rule `InternalCall`'s
      // `startCall` states. The call proceeds; only the timeline's label is at risk.
      this.logger.error(
        `ring-group ${record.callSid} answered on ${leg.e164} but the row failed: ` +
          String(err),
      );
    }
  }

  /**
   * End every mobile leg except `keepSid`.
   *
   * ⚠️ `canceled` for a leg that never answered, `completed` for one in progress — the rule
   * `hangUpCall` documents. Filing a still-ringing leg as `completed` risks SignalWire
   * recording the RING time as its duration, which `callOutcome` then reads as ANSWERED.
   */
  private async cancelLegs(
    record: RingGroupRecord,
    keepSid: string | null,
  ): Promise<void> {
    const targets = record.legs.filter((l) => l.legSid !== keepSid);
    if (!targets.length) return;
    await Promise.allSettled(
      targets.map(async (leg) => {
        try {
          const call = await this.signalwire.getCall(leg.legSid);
          // A leg SignalWire cannot find is already gone; `canceled` is the safe verb for
          // an unknown state, because `UNCONNECTED` contains it and the worst it can say is
          // "nobody was reached" — never a false ANSWERED.
          const status =
            call && !PRE_ANSWER.has(call.status) ? 'completed' : 'canceled';
          await this.signalwire.updateCall(leg.legSid, { status });
        } catch (err) {
          this.logger.warn(
            `ring-group ${record.callSid} could not end ${leg.e164}: ${String(err)}`,
          );
        }
      }),
    );
  }

  /**
   * Block until the caller's `<Dial>` has created its child leg.
   *
   * Returns TRUE when the dial has started (go ahead and ring the cell) and FALSE when it
   * demonstrably never did — which is a caller who hung up during the greeting. Dialling
   * then would ring a staff member's personal phone for a call that no longer exists, so
   * the two outcomes are deliberately NOT collapsed into one.
   *
   * ⚠️ An ERROR is the third case and resolves the other way: if we cannot ask SignalWire,
   * we cannot tell "not yet" from "never", so we dial immediately and degrade to the
   * pre-change behaviour (ringing a little early). Ringing early is the bug being fixed;
   * not ringing at all is a worse one.
   *
   * ⚠️ Re-filters on `parentCallSid` in memory. Whether `ParentCallSid` really filters
   * server-side is `conference-probe.mjs` #3, still unanswered, and every other caller
   * re-filters for the same reason (`call-control.service.ts`).
   */
  private async waitForDialChild(callSid: string): Promise<boolean> {
    const deadline = Date.now() + RingGroupService.MAX_GREETING_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const rows = await this.signalwire.listCalls({
          parentCallSid: callSid,
        });
        if (rows.some((c) => c.parentCallSid === callSid)) return true;
      } catch (err) {
        this.logger.warn(
          `ring-group ${callSid} could not check for the dial leg, ringing now: ` +
            String(err),
        );
        return true;
      }
      await new Promise((r) => setTimeout(r, RingGroupService.CHILD_POLL_MS));
    }
    return false;
  }

  private findByLeg(
    legSid: string,
  ): { record: RingGroupRecord; leg: RingLeg } | null {
    for (const record of this.groups.values()) {
      const leg = record.legs.find((l) => l.legSid === legSid);
      if (leg) return { record, leg };
    }
    return null;
  }

  /** One sentence, then hang up. Kept here so every dead end sounds the same. */
  private spoken(text: string, voice?: string): string {
    return response(sayVerb(text, { voice }) + hangupVerb());
  }

  private sweep(): void {
    const cutoff = Date.now() - RingGroupService.TTL_MS;
    for (const [sid, record] of this.groups) {
      if (record.at < cutoff) this.groups.delete(sid);
    }
  }
}
