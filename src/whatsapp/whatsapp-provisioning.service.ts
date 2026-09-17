import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomInt } from 'crypto';
import type { Subscription } from 'rxjs';
import type { Prisma, WhatsAppAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertRealCompany } from '../companies/company-target.util.js';
import { encrypt } from '../communications/crypto.util.js';
import {
  PhoneEventsService,
  type InboundSms,
} from '../phone/phone-events.service.js';
import { SignalWireService } from '../phone/signalwire.service.js';
import type { InboundVoiceCode } from '../phone/phone-events.service.js';
import { AiService } from '../ai/ai.service.js';
import {
  INTERNAL_MESSAGE,
  WhatsAppAccountService,
  toHttpError,
  toView,
} from './whatsapp-account.service.js';
import {
  WhatsAppGraphError,
  type CodeMethod,
  WhatsAppGraphService,
  type WabaPhoneNumber,
} from './whatsapp-graph.service.js';
import {
  extractSpokenCode,
  extractWhatsAppCode,
  shouldRetryByVoice,
  friendlyGraphMessage,
  splitNanpNumber,
  toDisplayName,
  whatsappConfig,
} from './whatsapp.util.js';
import type { WhatsAppAccountView } from './whatsapp.types.js';

/** How long a requested code may take to arrive before the attempt is called failed. */
export const CODE_TIMEOUT_MS = 15 * 60_000;
/**
 * How far before `codeRequestedAt` the sweep looks for the text. Small on purpose: a
 * retry must not pick up the code from the attempt it replaced.
 */
const SMS_LOOKBACK_MS = 15_000;
/** A VERIFYING row this old was interrupted (a restart mid-Graph-call). */
const VERIFYING_STALE_MS = 5 * 60_000;

/**
 * How long an inbound call to a support number may be diverted and recorded as a
 * WhatsApp verification code.
 *
 * ⚠️ MUCH shorter than `CODE_TIMEOUT_MS`, deliberately — they are different clocks. The
 * row can afford to sit PENDING for fifteen minutes; the phone line cannot, because every
 * minute this is armed is a minute a real client calling that company gets a recording
 * instead of a person. Meta calls within a minute or two of the request.
 */
export const VOICE_WINDOW_MS = 6 * 60_000;

/** A recording shorter than this cannot hold six spoken digits read twice. */
const MIN_CODE_RECORDING_SEC = 2;

/** Returned in the 409 body so the client knows to open the buy-a-number popup. */
export const NO_SUPPORT_NUMBER = 'NO_SUPPORT_NUMBER';

/**
 * "Generate WhatsApp account": a WhatsApp number made from the company's SignalWire
 * support number, with no Meta popup and no human reading an SMS.
 *
 * Meta's four steps for a number that skips Embedded Signup — add it to the WABA, request
 * a code, verify the code, register — run against the FIRM's WABA with the firm token
 * (`accessToken: NULL`, the existing "use WHATSAPP_TOKEN" meaning). The code is texted to
 * the support number, and SignalWire already posts every inbound text to our signed
 * webhook, so the server reads it itself:
 *
 * - FAST PATH: `PhoneEventsService.smsReceived$`, fed by `sms/inbound` after its
 *   signature check.
 * - BACKSTOP: a 30s sweep that asks SignalWire for recent texts to the number — covering a
 *   webhook missed during a restart, and a code that arrived before our row was written.
 *
 * The two can race for one code, which is why `complete` CLAIMS the row with a
 * conditional update first: a verify or register must never run twice.
 */
@Injectable()
export class WhatsAppProvisioningService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsAppProvisioningService.name);
  private subscription: Subscription | null = null;
  private voiceSubscription: Subscription | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: WhatsAppGraphService,
    private readonly accounts: WhatsAppAccountService,
    private readonly events: PhoneEventsService,
    private readonly signalwire: SignalWireService,
    private readonly ai: AiService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.events.smsReceived$.subscribe((sms) => {
      // `next` runs inside the webhook: this must neither throw nor make it wait.
      void this.onSms(sms).catch((err) =>
        this.logger.warn(`WhatsApp code check failed: ${String(err)}`),
      );
    });
    this.voiceSubscription = this.events.voiceCodeRecorded$.subscribe(
      (event) => {
        void this.onVoiceCode(event).catch((err) =>
          this.logger.warn(`WhatsApp voice code check failed: ${String(err)}`),
        );
      },
    );
    // The expectation map is in-process, so a restart mid-verification would leave Meta's
    // call ringing a member of staff. Re-arming from the rows costs one indexed query at
    // boot — the same "the row is the queue" argument `CallSummary` makes.
    void this.rearmVoiceExpectations().catch((err) =>
      this.logger.warn(
        `re-arming WhatsApp voice expectations failed: ${String(err)}`,
      ),
    );
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.voiceSubscription?.unsubscribe();
  }

  /** Put every still-pending VOICE verification back on the webhook's watch list. */
  private async rearmVoiceExpectations(): Promise<void> {
    const rows = await this.prisma.whatsAppAccount.findMany({
      where: {
        setupStatus: 'PENDING_CODE',
        codeMethod: 'VOICE',
        codeRequestedAt: { gt: new Date(Date.now() - VOICE_WINDOW_MS) },
      },
      select: { companyId: true, codeRequestedAt: true },
    });
    for (const row of rows) {
      const support = await this.prisma.supportNumber.findFirst({
        where: { companyId: row.companyId, releasedAt: null },
        select: { phoneNumber: true },
      });
      if (!support || !row.codeRequestedAt) continue;
      const left =
        VOICE_WINDOW_MS - (Date.now() - row.codeRequestedAt.getTime());
      if (left > 0) this.events.expectVoiceCode(support.phoneNumber, left);
    }
  }

  async generate(
    companyId: number,
    userId: number,
  ): Promise<WhatsAppAccountView> {
    await assertRealCompany(this.prisma, companyId, INTERNAL_MESSAGE);

    const cfg = whatsappConfig(process.env);
    const missing = [
      cfg.firmToken ? null : 'WHATSAPP_TOKEN',
      cfg.firmWabaId ? null : 'WHATSAPP_BUSINESS_ACCOUNT_ID',
    ].filter((key): key is string => key !== null);
    if (missing.length) {
      throw new ServiceUnavailableException(
        `WhatsApp numbers cannot be generated until ${missing.join(' and ')} is set on the server`,
      );
    }
    const token = cfg.firmToken!;
    const wabaId = cfg.firmWabaId!;
    // Refuse before touching Meta rather than after a number has been added.
    this.accounts.encryptionKey();

    const support = await this.prisma.supportNumber.findFirst({
      where: { companyId, releasedAt: null },
      select: { phoneNumber: true },
    });
    if (!support) {
      throw new ConflictException({
        statusCode: 409,
        code: NO_SUPPORT_NUMBER,
        message:
          'This company has no support number yet. Connect one, then generate WhatsApp.',
      });
    }
    const parts = splitNanpNumber(support.phoneNumber);
    if (!parts) {
      throw new BadRequestException(
        `The support number ${support.phoneNumber} is not a Canadian or US number, so it cannot be added to WhatsApp`,
      );
    }

    // A FAILED or still-waiting attempt is RESUMED (a new code is sent); anything else is
    // a number this company already has.
    const existing = await this.prisma.whatsAppAccount.findUnique({
      where: { companyId },
    });
    if (
      existing &&
      existing.setupStatus !== 'FAILED' &&
      existing.setupStatus !== 'PENDING_CODE'
    ) {
      throw new ConflictException(
        existing.setupStatus === 'CONNECTED'
          ? 'This company already has a WhatsApp number'
          : 'WhatsApp is already finishing setup for this company',
      );
    }

    // The firm's name, never the company's: Meta reviews the display name against the
    // business that owns the WABA, and registered names ("9498-5140 Québec inc.,
    // logistics") are rejected before any number is added. See `whatsappConfig`.
    const verifiedName = toDisplayName(cfg.displayName);

    let phone: WabaPhoneNumber;
    try {
      phone = await this.addOrFind(wabaId, parts, verifiedName, token);
    } catch (err) {
      toHttpError(err);
    }
    await this.accounts.assertNumberFree(phone.id, companyId);

    const base = {
      wabaId,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName ?? verifiedName,
      accessToken: null,
      origin: 'GENERATED',
      setupError: null,
      connectedById: userId,
    };

    // Already registered: an earlier attempt got that far and lost its row write.
    if (phone.status === 'CONNECTED') {
      const row = await this.upsert(companyId, {
        ...base,
        setupStatus: 'CONNECTED',
        codeRequestedAt: null,
        connectedAt: new Date(),
      });
      await this.subscribe(wabaId, token);
      return toView(row);
    }

    // Verified but not registered (register failed last time): no new code needed.
    if (phone.codeVerificationStatus === 'VERIFIED') {
      const row = await this.upsert(companyId, {
        ...base,
        setupStatus: 'PENDING_CODE',
        codeRequestedAt: new Date(),
      });
      return this.complete(row, null);
    }

    /**
     * Ask Meta to send the code — by text, and by VOICE if the text cannot be delivered.
     *
     * ⚠️ A FAILED request_code must NEVER fall through to `register`. It used to: a
     * `code === 136024` was read as "already verified" and jumped straight to
     * `complete(row, null)`, which skips verify_code. Register then answered *"Phone
     * number is not verified through sms or voice…"*, and THAT is the message that
     * reached the card — naming a step that had never run, for a code Meta never sent.
     * Verified in production: 136024 is a generic request_code failure, and came back as
     * both "Number unreachable" and "Please try again in some time" on the same number.
     *
     * The genuinely-already-verified case is handled by the `codeVerificationStatus`
     * branch above, which reads Meta's own view of the number, so nothing is lost.
     */
    const method = await this.requestCodeWithFallback(phone.id, token);
    if (method === 'VOICE') {
      // Arms the inbound webhook to RECORD Meta's call instead of ringing somebody.
      // Narrow and self-expiring — see `VOICE_WINDOW_MS`.
      this.events.expectVoiceCode(support.phoneNumber, VOICE_WINDOW_MS);
    }

    const row = await this.upsert(companyId, {
      ...base,
      setupStatus: 'PENDING_CODE',
      codeMethod: method,
      codeRequestedAt: new Date(),
      registrationPin: null,
    });
    this.logger.log(
      `company ${companyId} generating WhatsApp on ${support.phoneNumber} (phone ${phone.id}) ` +
        `by user ${userId} — waiting for the code by ${method}`,
    );
    return toView(row);
  }

  /**
   * Ask for the code by TEXT, and fall back to a VOICE call if the text cannot be sent.
   *
   * Meta's own failure says "try an alternate verification method", and on this account it
   * says it for every number: the support numbers are in a very new area code that Meta's
   * SMS aggregator reports as unreachable, while ordinary calls and texts reach them fine.
   * A voice call is a different delivery path, so it is worth the second request.
   *
   * Returns which method is now pending — the row has to record it, because it decides
   * whether the inbound webhook should intercept Meta's call and whether the sweep should
   * bother scanning texts.
   */
  private async requestCodeWithFallback(
    phoneNumberId: string,
    token: string,
  ): Promise<CodeMethod> {
    try {
      await this.graph.requestCode(phoneNumberId, token, 'SMS');
      return 'SMS';
    } catch (smsErr) {
      const code = smsErr instanceof WhatsAppGraphError ? smsErr.code : null;
      // A revoked token or an attempt ceiling fails identically by voice, and asking
      // again spends a second attempt against the very limit that is the problem.
      if (!shouldRetryByVoice(code)) toHttpError(smsErr);
      this.logger.warn(
        `requestCode SMS failed for ${phoneNumberId} (code=${String(code)}), trying VOICE: ${String(smsErr)}`,
      );
      try {
        await this.graph.requestCode(phoneNumberId, token, 'VOICE');
        return 'VOICE';
      } catch {
        // The SMS error is the one reported: it is the method Meta is expected to manage,
        // and its message ("Number unreachable", "Please try again in some time") is what
        // actually tells somebody what went wrong.
        toHttpError(smsErr);
      }
    }
  }

  /** The fast path: a text to a support number that is waiting for Meta's code. */
  async onSms(sms: InboundSms): Promise<void> {
    const code = extractWhatsAppCode(sms.body);
    if (!code || !sms.to) return;
    const support = await this.prisma.supportNumber.findFirst({
      where: { phoneNumber: sms.to, releasedAt: null },
      select: { companyId: true },
    });
    if (!support) return;
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { companyId: support.companyId },
    });
    if (account?.setupStatus !== 'PENDING_CODE') return;
    /**
     * ⚠️ Only when a TEXT is what we are waiting for.
     *
     * With a VOICE code pending, Meta will never text — but this listener is still armed,
     * and `extractWhatsAppCode` matches any message that mentions WhatsApp and holds six
     * digits. A client texting the support number "is whatsapp ok? my ref is 493 021"
     * would claim the row and send 493021 to `verify_code`: a wrong code, a FAILED
     * number, and one of the ten register attempts Meta allows per 72 hours, spent.
     */
    if (account.codeMethod === 'VOICE') return;
    this.logger.log(
      `WhatsApp code arrived by webhook for company ${support.companyId}`,
    );
    await this.complete(account, code);
  }

  /**
   * Look for a recorded verification call ourselves, rather than waiting to be told.
   *
   * One `listCalls` per pending VOICE row per sweep — and there is at most one such row
   * at a time in practice, since a number is generated by hand.
   */
  private async sweepVoiceCode(
    row: WhatsAppAccount,
    supportNumber: string,
    requestedAt: number,
  ): Promise<void> {
    const calls = await this.signalwire.listCalls({
      to: supportNumber,
      after: requestedAt - SMS_LOOKBACK_MS,
    });
    for (const call of calls) {
      if (call.direction !== 'inbound') continue;
      const fresh = await this.pendingVoiceRowFor(
        supportNumber,
        call.startedAt,
      );
      if (!fresh) return;
      await this.readCodeFromCall(fresh, call.sid, null);
      // One call per sweep: `readCodeFromCall` either finished the setup (and the row is
      // no longer PENDING_CODE) or the recording held nothing, and either way the next
      // tick is 30 seconds away.
      return;
    }
  }

  /**
   * Meta's verification call, recorded — the fast path, when SignalWire requests the
   * `<Record action>` URL.
   */
  private async onVoiceCode(event: InboundVoiceCode): Promise<void> {
    const account = await this.pendingVoiceRowFor(event.to, event.startedAt);
    if (!account) return;
    this.logger.log(
      `WhatsApp verification recording arrived by webhook for company ${account.companyId}`,
    );
    await this.readCodeFromCall(account, event.callSid, event.recordingSid);
  }

  /** The row waiting for a VOICE code on this number, if the call is recent enough. */
  private async pendingVoiceRowFor(
    supportNumber: string,
    callStartedAt: number,
  ): Promise<WhatsAppAccount | null> {
    if (!supportNumber) return null;
    const support = await this.prisma.supportNumber.findFirst({
      where: { phoneNumber: supportNumber, releasedAt: null },
      select: { companyId: true },
    });
    if (!support) return null;
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { companyId: support.companyId },
    });
    if (
      account?.setupStatus !== 'PENDING_CODE' ||
      account.codeMethod !== 'VOICE' ||
      !account.codeRequestedAt
    ) {
      return null;
    }
    /**
     * ⚠️ The call must belong to the CURRENT attempt.
     *
     * Somebody who clicks Generate twice gets a fresh `codeRequestedAt` while a recording
     * from the first call is still being transcribed. The row is legitimately PENDING_CODE
     * again, so the claim in `complete` would not catch it — and the stale code would be
     * sent to Meta, fail, and spend one of ten register attempts per 72 hours.
     */
    if (callStartedAt < account.codeRequestedAt.getTime()) {
      this.logger.warn(
        `ignoring a verification recording from before the current attempt (company ${account.companyId})`,
      );
      return null;
    }
    return account;
  }

  /**
   * Fetch the recording, transcribe it, read the code off it, and finish the setup.
   *
   * Shared by the webhook and the sweep, which differ only in whether they already know
   * the recording's sid.
   */
  private async readCodeFromCall(
    account: WhatsAppAccount,
    callSid: string,
    recordingSid: string | null,
  ): Promise<void> {
    let sid = recordingSid;
    if (!sid) {
      const recordings = await this.signalwire.listRecordings({ callSid });
      const usable = recordings.find(
        (r) => r.durationSec >= MIN_CODE_RECORDING_SEC,
      );
      if (!usable) return;
      sid = usable.sid;
    }

    const { buffer } = await this.signalwire.fetchRecordingMedia(sid);
    const transcript = await this.ai.transcribeAudio(
      buffer,
      `wa-code-${sid}.mp3`,
    );
    const code = extractSpokenCode(transcript);
    this.logger.log(
      `WhatsApp verification transcript for company ${account.companyId}: ` +
        `${JSON.stringify(transcript.slice(0, 120))} -> ${code ?? 'NO CODE'}`,
    );
    if (!code) return;

    const support = await this.prisma.supportNumber.findFirst({
      where: { companyId: account.companyId, releasedAt: null },
      select: { phoneNumber: true },
    });
    if (support) this.events.clearVoiceCode(support.phoneNumber);

    await this.complete(account, code);

    /**
     * The recording is deleted once the code is off it, and that is not tidiness.
     *
     * An inbound call with a recording is how `buildPhoneItems` derives a VOICEMAIL — so
     * left in place, Meta's robot would appear in that client's own Communications tab as
     * a voicemail, complete with a player, and would count toward the missed-call badge,
     * the tab icon and the bell. Best-effort: a failure here costs a stray row, never the
     * verification.
     */
    await this.signalwire
      .deleteRecording(sid)
      .catch((err: unknown) =>
        this.logger.warn(
          `could not delete the WhatsApp verification recording ${sid}: ${String(err)}`,
        ),
      );
  }

  /**
   * Verify (when a code is given), register, subscribe. Never throws: the outcome is the
   * row's status, which the client polls.
   */
  async complete(
    account: WhatsAppAccount,
    code: string | null,
  ): Promise<WhatsAppAccountView> {
    const claimed = await this.prisma.whatsAppAccount.updateMany({
      where: { id: account.id, setupStatus: 'PENDING_CODE' },
      data: { setupStatus: 'VERIFYING' },
    });
    if (claimed.count === 0) {
      // The webhook and the sweep raced; the other one owns this attempt.
      const current = await this.prisma.whatsAppAccount.findUnique({
        where: { id: account.id },
      });
      return toView(current ?? account);
    }

    const cfg = whatsappConfig(process.env);
    try {
      if (!cfg.firmToken) {
        throw new WhatsAppGraphError(
          'WHATSAPP_TOKEN is no longer set on the server',
          0,
        );
      }
      if (code) {
        await this.graph.verifyCode(account.phoneNumberId, code, cfg.firmToken);
      }
      const pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await this.graph.registerNumber(
        account.phoneNumberId,
        pin,
        cfg.firmToken,
      );
      const registrationPin = encrypt(pin, this.accounts.encryptionKey());
      if (cfg.firmWabaId) await this.subscribe(cfg.firmWabaId, cfg.firmToken);

      const row = await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          setupStatus: 'CONNECTED',
          setupError: null,
          registrationPin,
          connectedAt: new Date(),
        },
      });
      this.logger.log(
        `company ${account.companyId} WhatsApp ${account.displayPhoneNumber} is connected`,
      );
      return toView(row);
    } catch (err) {
      const message =
        err instanceof WhatsAppGraphError
          ? friendlyGraphMessage(err.code, err.message)
          : 'WhatsApp setup failed unexpectedly. Try again.';
      this.logger.warn(
        `WhatsApp setup for company ${account.companyId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      const row = await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: { setupStatus: 'FAILED', setupError: message },
      });
      return toView(row);
    }
  }

  /**
   * The backstop. Re-entrancy flag as in `CallSummaryService`: a slow SignalWire read must
   * not let a second tick start the same verification.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepPending(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.prisma.whatsAppAccount.updateMany({
        where: {
          setupStatus: 'VERIFYING',
          updatedAt: { lt: new Date(Date.now() - VERIFYING_STALE_MS) },
        },
        data: {
          setupStatus: 'FAILED',
          setupError: 'WhatsApp setup was interrupted. Try again.',
        },
      });
      const rows = await this.prisma.whatsAppAccount.findMany({
        where: { setupStatus: 'PENDING_CODE' },
      });
      for (const row of rows) {
        await this.checkPending(row).catch((err) =>
          this.logger.warn(
            `WhatsApp code sweep for company ${row.companyId} failed: ${String(err)}`,
          ),
        );
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async checkPending(row: WhatsAppAccount): Promise<void> {
    const requestedAt = (row.codeRequestedAt ?? row.updatedAt).getTime();
    const support = await this.prisma.supportNumber.findFirst({
      where: { companyId: row.companyId, releasedAt: null },
      select: { phoneNumber: true },
    });
    /**
     * A VOICE row waits for Meta to CALL, so there is no text to find.
     *
     * ⚠️ And the webhook cannot be relied on to deliver the recording either: CLAUDE.md
     * records as verified fact that SignalWire does not request a `<Record action>` URL
     * when the caller hangs up, which is exactly what Meta's robot does. So this sweep is
     * the MECHANISM and `voice/wa-code` is the shortcut — the inverse of how the SMS path
     * is weighted.
     */
    if (support && row.codeMethod === 'VOICE') {
      await this.sweepVoiceCode(row, support.phoneNumber, requestedAt);
    }

    if (support && row.codeMethod !== 'VOICE') {
      const messages = await this.signalwire.listMessages({
        to: support.phoneNumber,
        after: requestedAt - SMS_LOOKBACK_MS,
      });
      const code = messages
        .map((m) => extractWhatsAppCode(m.body))
        .find((c): c is string => c !== null);
      if (code) {
        this.logger.log(
          `WhatsApp code found by sweep for company ${row.companyId}`,
        );
        await this.complete(row, code);
        return;
      }
    }
    if (Date.now() - requestedAt > CODE_TIMEOUT_MS) {
      await this.prisma.whatsAppAccount.updateMany({
        where: { id: row.id, setupStatus: 'PENDING_CODE' },
        data: {
          setupStatus: 'FAILED',
          // Worded for the method that was actually used: telling somebody a text never
          // arrived, when Meta was asked to phone, sends them looking in the wrong place.
          setupError:
            row.codeMethod === 'VOICE'
              ? "Meta's verification call never reached the support number. Try again to send a new code."
              : "Meta's verification text never arrived at the support number. Try again to send a new code.",
        },
      });
    }
  }

  /** Looked up first, so a retry reuses the number an earlier attempt already added. */
  private async addOrFind(
    wabaId: string,
    parts: { cc: string; number: string },
    verifiedName: string,
    token: string,
  ): Promise<WabaPhoneNumber> {
    const digits = `${parts.cc}${parts.number}`;
    const found = await this.graph.findWabaPhoneNumber(wabaId, digits, token);
    if (found) return found;
    const id = await this.graph.addPhoneNumber(
      wabaId,
      parts.cc,
      parts.number,
      verifiedName,
      token,
    );
    return this.graph.getPhoneNumber(id, token);
  }

  /** Per WABA and idempotent. Best-effort here: the number itself is already usable. */
  private async subscribe(wabaId: string, token: string): Promise<void> {
    await this.graph.subscribeApp(wabaId, token).catch((err) => {
      this.logger.warn(`subscribeApp ${wabaId} failed: ${String(err)}`);
    });
  }

  private upsert(
    companyId: number,
    data: Omit<Prisma.WhatsAppAccountUncheckedCreateInput, 'companyId'>,
  ): Promise<WhatsAppAccount> {
    return this.prisma.whatsAppAccount.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }
}
