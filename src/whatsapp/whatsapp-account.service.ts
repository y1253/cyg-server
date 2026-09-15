import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import type { WhatsAppAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertRealCompany } from '../companies/company-target.util.js';
import { decrypt, encrypt } from '../communications/crypto.util.js';
import {
  WhatsAppGraphError,
  WhatsAppGraphService,
} from './whatsapp-graph.service.js';
import { friendlyGraphMessage, whatsappConfig } from './whatsapp.util.js';
import type { ConnectWhatsAppDto } from './dto/whatsapp.dto.js';
import type {
  WhatsAppAccountView,
  WhatsAppClientConfig,
  WhatsAppConnectResult,
} from './whatsapp.types.js';

const INTERNAL_MESSAGE =
  'An internal workspace has no WhatsApp number to connect';

function toView(row: WhatsAppAccount): WhatsAppAccountView {
  return {
    companyId: row.companyId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    usesFirmToken: row.accessToken === null,
    connectedAt: row.connectedAt.toISOString(),
  };
}

/** A Graph failure as an HTTP error an admin can read; anything else is rethrown. */
function toHttpError(err: unknown): never {
  if (err instanceof WhatsAppGraphError) {
    const message = friendlyGraphMessage(err.code, err.message);
    if (err.httpStatus === 0) throw new ServiceUnavailableException(message);
    throw new BadRequestException(message);
  }
  throw err;
}

/**
 * Which WhatsApp number a company uses, and the token that speaks for it.
 *
 * ⚠️ Meta issues NO refresh token. Embedded Signup's code exchange yields a business
 * integration token that lasts until the customer revokes it, so that is what is stored,
 * encrypted with the same `crypto.util` as the Gmail/Outlook tokens. There is nothing to
 * refresh; a revoked token surfaces as Graph error 190 on the next send, which
 * `friendlyGraphMessage` turns into "reconnect".
 */
@Injectable()
export class WhatsAppAccountService {
  private readonly logger = new Logger(WhatsAppAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: WhatsAppGraphService,
  ) {}

  clientConfig(): WhatsAppClientConfig {
    const cfg = whatsappConfig(process.env);
    return {
      appId: cfg.appId,
      configId: cfg.configId,
      graphVersion: cfg.graphVersion,
      firmNumberAvailable:
        cfg.firmToken !== null && cfg.firmPhoneNumberId !== null,
    };
  }

  async getAccount(companyId: number): Promise<WhatsAppAccountView | null> {
    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { companyId },
    });
    return row ? toView(row) : null;
  }

  /**
   * Finish Embedded Signup for a company.
   *
   * The code lives for 30 SECONDS, so after one cheap company check the exchange runs
   * before anything else. The ids the popup posted are then checked against what the new
   * token can actually see — the client is not trusted to name a number.
   */
  async connect(
    companyId: number,
    dto: ConnectWhatsAppDto,
    userId: number,
  ): Promise<WhatsAppConnectResult> {
    await assertRealCompany(this.prisma, companyId, INTERNAL_MESSAGE);
    const key = this.encryptionKey();

    let token: string;
    try {
      token = await this.graph.exchangeCode(dto.code);
    } catch (err) {
      toHttpError(err);
    }

    let phone: Awaited<ReturnType<WhatsAppGraphService['getPhoneNumber']>>;
    try {
      const ids = await this.graph.listWabaPhoneNumberIds(dto.wabaId, token);
      if (!ids.includes(dto.phoneNumberId)) {
        throw new BadRequestException(
          'That phone number does not belong to the WhatsApp Business account you connected',
        );
      }
      phone = await this.graph.getPhoneNumber(dto.phoneNumberId, token);
    } catch (err) {
      toHttpError(err);
    }

    await this.assertNumberFree(dto.phoneNumberId, companyId);

    // Not best-effort: without the subscription Meta delivers this number's messages to
    // nobody, and a "connected" number that never receives anything is worse than an error.
    try {
      await this.graph.subscribeApp(dto.wabaId, token);
    } catch (err) {
      toHttpError(err);
    }

    let warning: string | null = null;
    let registrationPin: string | null = null;
    if (phone.status !== 'CONNECTED') {
      const pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
      try {
        await this.graph.registerNumber(dto.phoneNumberId, pin, token);
        registrationPin = encrypt(pin, key);
      } catch (err) {
        // Best-effort, and SAVED anyway: the code is already spent, so throwing here would
        // make the admin redo the whole popup for a step they can finish in WhatsApp Manager.
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `registerNumber ${dto.phoneNumberId} for company ${companyId} failed: ${detail}`,
        );
        warning = `The number was connected, but WhatsApp did not finish registering it (${detail}). Messages may not send until it is registered in WhatsApp Manager.`;
      }
    }

    const data = {
      wabaId: dto.wabaId,
      phoneNumberId: dto.phoneNumberId,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName,
      accessToken: encrypt(token, key),
      registrationPin,
      connectedById: userId,
      connectedAt: new Date(),
    };
    const row = await this.prisma.whatsAppAccount.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    this.logger.log(
      `company ${companyId} connected WhatsApp ${phone.displayPhoneNumber} (waba ${dto.wabaId}) by user ${userId}`,
    );
    return { account: toView(row), warning };
  }

  /**
   * Attach the firm's own number (WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TOKEN) without the
   * popup. `accessToken` stays NULL so the env token is read at use time — revoking and
   * reissuing it then needs only an env edit, not a hunt for stale copies.
   */
  async connectFirmNumber(
    companyId: number,
    userId: number,
  ): Promise<WhatsAppConnectResult> {
    await assertRealCompany(this.prisma, companyId, INTERNAL_MESSAGE);
    const cfg = whatsappConfig(process.env);
    if (!cfg.firmToken || !cfg.firmPhoneNumberId) {
      throw new ServiceUnavailableException(
        'The firm WhatsApp number is not configured on the server (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)',
      );
    }

    let phone: Awaited<ReturnType<WhatsAppGraphService['getPhoneNumber']>>;
    try {
      phone = await this.graph.getPhoneNumber(
        cfg.firmPhoneNumberId,
        cfg.firmToken,
      );
    } catch (err) {
      toHttpError(err);
    }

    await this.assertNumberFree(cfg.firmPhoneNumberId, companyId);

    let warning: string | null = null;
    if (cfg.firmWabaId) {
      try {
        await this.graph.subscribeApp(cfg.firmWabaId, cfg.firmToken);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        warning = `Connected, but subscribing to its messages failed (${detail}). Incoming messages may not arrive.`;
      }
    } else {
      warning =
        'WHATSAPP_BUSINESS_ACCOUNT_ID is not set, so the webhook subscription was not checked.';
    }

    const data = {
      wabaId: cfg.firmWabaId ?? '',
      phoneNumberId: cfg.firmPhoneNumberId,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName,
      accessToken: null,
      registrationPin: null,
      connectedById: userId,
      connectedAt: new Date(),
    };
    const row = await this.prisma.whatsAppAccount.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    this.logger.log(
      `company ${companyId} attached the firm WhatsApp number ${phone.displayPhoneNumber} by user ${userId}`,
    );
    return { account: toView(row), warning };
  }

  /**
   * Remove the connection. Message HISTORY is kept: it belongs to the company, not to
   * the connection, and a reconnect should find the conversation where it was left.
   */
  async disconnect(companyId: number): Promise<void> {
    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { companyId },
    });
    if (!row) throw new NotFoundException('No WhatsApp number is connected');

    // Only an Embedded Signup connection is unsubscribed. The firm token's WABA is ours,
    // and unsubscribing it would silence the firm number wherever it is used next.
    if (row.accessToken) {
      const token = this.tokenFor(row);
      if (token && row.wabaId) {
        await this.graph.unsubscribeApp(row.wabaId, token).catch((err) => {
          this.logger.warn(
            `unsubscribeApp ${row.wabaId} on disconnect failed: ${String(err)}`,
          );
        });
      }
    }
    await this.prisma.whatsAppAccount.delete({ where: { companyId } });
    this.logger.log(
      `company ${companyId} disconnected WhatsApp ${row.displayPhoneNumber}`,
    );
  }

  /** The connected account and a usable token, or a 400 the composer can show. */
  async requireActive(
    companyId: number,
  ): Promise<{ account: WhatsAppAccount; token: string }> {
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { companyId },
    });
    if (!account) {
      throw new BadRequestException(
        'No WhatsApp number is connected to this company',
      );
    }
    const token = this.tokenFor(account);
    if (!token) {
      throw new ServiceUnavailableException(
        'The WhatsApp token for this company is unavailable. Reconnect WhatsApp.',
      );
    }
    return { account, token };
  }

  /** Used by the media downloader, which starts from a message's phone number id. */
  async tokenForPhoneNumber(phoneNumberId: string): Promise<string | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { phoneNumberId },
    });
    if (account) return this.tokenFor(account);
    // A disconnected firm number can still fetch its own media with the env token.
    const cfg = whatsappConfig(process.env);
    return cfg.firmPhoneNumberId === phoneNumberId ? cfg.firmToken : null;
  }

  tokenFor(account: WhatsAppAccount): string | null {
    if (!account.accessToken) return whatsappConfig(process.env).firmToken;
    try {
      return decrypt(account.accessToken, this.encryptionKey());
    } catch (err) {
      this.logger.error(
        `could not decrypt the WhatsApp token for company ${account.companyId}: ${String(err)}`,
      );
      return null;
    }
  }

  private async assertNumberFree(phoneNumberId: string, companyId: number) {
    const taken = await this.prisma.whatsAppAccount.findUnique({
      where: { phoneNumberId },
      select: { companyId: true },
    });
    if (taken && taken.companyId !== companyId) {
      throw new ConflictException(
        'This WhatsApp number is already connected to another company',
      );
    }
  }

  /** Refuses rather than storing a token under a missing or malformed key. */
  private encryptionKey(): string {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
      throw new ServiceUnavailableException(
        'ENCRYPTION_KEY is not configured, so a WhatsApp token cannot be stored',
      );
    }
    return key;
  }
}
