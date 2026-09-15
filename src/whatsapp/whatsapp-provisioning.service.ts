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
import {
  INTERNAL_MESSAGE,
  WhatsAppAccountService,
  toHttpError,
  toView,
} from './whatsapp-account.service.js';
import {
  WhatsAppGraphError,
  WhatsAppGraphService,
  type WabaPhoneNumber,
} from './whatsapp-graph.service.js';
import {
  extractWhatsAppCode,
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
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: WhatsAppGraphService,
    private readonly accounts: WhatsAppAccountService,
    private readonly events: PhoneEventsService,
    private readonly signalwire: SignalWireService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.events.smsReceived$.subscribe((sms) => {
      // `next` runs inside the webhook: this must neither throw nor make it wait.
      void this.onSms(sms).catch((err) =>
        this.logger.warn(`WhatsApp code check failed: ${String(err)}`),
      );
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
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

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { businessName: true },
    });
    const verifiedName = toDisplayName(company?.businessName ?? '');
    if (!verifiedName) {
      throw new BadRequestException(
        'The company needs a business name before it can have a WhatsApp number',
      );
    }

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

    try {
      await this.graph.requestCode(phone.id, token);
    } catch (err) {
      if (err instanceof WhatsAppGraphError && err.code === 136024) {
        const row = await this.upsert(companyId, {
          ...base,
          setupStatus: 'PENDING_CODE',
          codeRequestedAt: new Date(),
        });
        return this.complete(row, null);
      }
      toHttpError(err);
    }

    const row = await this.upsert(companyId, {
      ...base,
      setupStatus: 'PENDING_CODE',
      codeRequestedAt: new Date(),
      registrationPin: null,
    });
    this.logger.log(
      `company ${companyId} generating WhatsApp on ${support.phoneNumber} (phone ${phone.id}) by user ${userId} — waiting for the code`,
    );
    return toView(row);
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
    this.logger.log(
      `WhatsApp code arrived by webhook for company ${support.companyId}`,
    );
    await this.complete(account, code);
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
    if (support) {
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
          setupError:
            "Meta's verification text never arrived at the support number. Try again to send a new code.",
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
