import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SupportNumber } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from './signalwire.service.js';
import {
  isValidAreaCode,
  toIsoCountry,
  type AvailableNumber,
  type IsoCountry,
} from './signalwire-parse.js';
import { maxPurchasesPerDay, regionsFor, webhookUrls } from './phone.config.js';

export interface ProvisionOutcome {
  status: 'attached' | 'skipped' | 'failed';
  reason?: string;
  number?: SupportNumber;
}

/**
 * Company-aware orchestration around SignalWire.
 *
 * Everything money-related lives here, and the ordering of the steps IS the design —
 * see `attachNumber`. `SignalWireService` stays ignorant of companies so this layer can
 * be tested without a network.
 */
@Injectable()
export class PhoneProvisioningService {
  private readonly logger = new Logger(PhoneProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────────

  /** The company's active number, or null. Never throws for "none". */
  async getActiveNumber(companyId: number): Promise<SupportNumber | null> {
    return this.prisma.supportNumber.findFirst({
      where: { companyId, releasedAt: null },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * Admin search. `country` is the free-text `Company.country` value.
   *
   * Results are filtered to numbers that do BOTH voice and SMS, so an admin is never
   * offered something that cannot serve as a support line. On a US search today that
   * legitimately returns an empty list — no US number on the account is SMS-capable
   * until A2P 10DLC registration completes.
   */
  async searchAvailable(
    country: string,
    areaCode?: string,
  ): Promise<AvailableNumber[]> {
    const iso = toIsoCountry(country);
    if (!iso) {
      throw new BadRequestException(
        `Unsupported country "${country}" — expected USA or CANADA`,
      );
    }
    if (
      areaCode !== undefined &&
      areaCode !== '' &&
      !isValidAreaCode(areaCode)
    ) {
      throw new BadRequestException(
        'Area code must be 3 digits and cannot start with 0 or 1',
      );
    }
    return this.searchEligible(iso, areaCode || undefined);
  }

  /**
   * Searches for numbers meeting the capability bar, walking the country's region list.
   *
   * An explicit area code overrides regions entirely: the admin asked for a specific
   * place, so we do not silently widen the search to somewhere else.
   */
  private async searchEligible(
    iso: IsoCountry,
    areaCode?: string,
  ): Promise<AvailableNumber[]> {
    if (areaCode) {
      return this.eligible(
        await this.signalwire.searchAvailable(iso, { areaCode }),
      );
    }

    const regions = regionsFor(iso, process.env);
    // An empty region list means "search unfiltered" — one attempt, no region param.
    const attempts: (string | undefined)[] =
      regions.length > 0 ? regions : [undefined];

    for (const inRegion of attempts) {
      const found = this.eligible(
        await this.signalwire.searchAvailable(iso, { inRegion }),
      );
      if (found.length > 0) return found;
    }
    return [];
  }

  /**
   * The capability bar: a support number must be able to take calls AND texts.
   *
   * Enforced here rather than per-country, which is what makes the US case
   * self-healing: today every US candidate fails this filter because A2P 10DLC is
   * pending, so US companies are skipped. The moment registration completes, US numbers
   * start reporting SMS capability and this same code begins provisioning them with no
   * change at all.
   */
  private eligible(numbers: AvailableNumber[]): AvailableNumber[] {
    return numbers.filter((n) => n.voice && n.sms);
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /**
   * Buys a specific number and attaches it to a company.
   *
   * The ordering below is deliberate and load-bearing:
   *
   *   1-2. every cheap guard runs BEFORE any money is spent
   *   3.   purchase — external, billed, not rollback-able
   *   4.   capability re-check
   *   5.   DB write, mirrored to Company.supportNumber
   *   6.   on any failure after step 3, a COMPENSATING RELEASE
   *
   * Steps 3 and 5 cannot share a transaction: a Prisma interactive transaction holds a
   * DB transaction open (5s default) and a 20s purchase must not sit inside it. The
   * compensating release is the substitute, and it turns "orphaned paid number" from
   * the default failure mode into a rare double failure.
   *
   * Purchase happens BEFORE the DB write, not after, because the reverse trades an
   * orphaned number for an orphaned ROW pointing at a number that does not exist — and
   * that row makes the company look provisioned, so calls fail silently for weeks. A
   * number with no row costs a dollar a month and shows up in an audit. Prefer the
   * failure you can see.
   */
  async attachNumber(
    companyId: number,
    phoneNumber: string,
    /**
     * Province / state the number came from, carried over from the search result.
     * Optional because it is descriptive metadata, not a key — SignalWire does not
     * return a region on the purchase response, so this is the only chance to keep it.
     */
    region?: string | null,
  ): Promise<SupportNumber> {
    const company = await this.assertProvisionable(companyId);

    if (await this.getActiveNumber(companyId)) {
      throw new ConflictException(
        'This company already has a support number. Disconnect it first.',
      );
    }

    const purchased = await this.signalwire.purchaseNumber({
      phoneNumber,
      friendlyName: company.businessName,
      ...webhookUrls(process.env),
    });

    try {
      // Release ONLY on a POSITIVE report of incapability.
      //
      // `eligible()` already proved this number does voice+SMS, from SignalWire's own
      // search response, before the admin was ever offered it. A purchase response that
      // merely fails to REPEAT that claim is not evidence against it — and the purchase
      // response's capability shape has never actually been observed (the probe is
      // read-only; see scripts/signalwire-probe.mjs). Reading an absent field as `false`
      // is what made every buy end in "is not both voice- and SMS-capable", releasing a
      // number we had just paid for. Do not put a `!` back in front of these.
      if (purchased.voice === false || purchased.sms === false) {
        throw new BadRequestException(
          `${purchased.phoneNumber} came back voice=${String(purchased.voice)} ` +
            `sms=${String(purchased.sms)} from SignalWire ` +
            `(capabilities: ${purchased.capabilitiesRaw ?? 'absent'}) — it cannot ` +
            `serve as a support line, so it has been released`,
        );
      }

      if (purchased.voice === null || purchased.sms === null) {
        this.logger.warn(
          `purchaseNumber ${purchased.phoneNumber} did not report capabilities ` +
            `(raw: ${purchased.capabilitiesRaw ?? 'absent'}) — keeping it; the search ` +
            `filter already confirmed voice+SMS for this number`,
        );
      }

      return await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: two concurrent registrations could both
        // pass the check above. The activeForCompanyId unique index is the real
        // backstop, but this turns the common case into a clean 409.
        const existing = await tx.supportNumber.findFirst({
          where: { companyId, releasedAt: null },
        });
        if (existing) {
          throw new ConflictException(
            'This company already has a support number. Disconnect it first.',
          );
        }

        const row = await tx.supportNumber.create({
          data: {
            companyId,
            activeForCompanyId: companyId,
            sid: purchased.sid,
            phoneNumber: purchased.phoneNumber,
            region: region ?? null,
          },
        });

        // Mirror onto Company.supportNumber so the email-signature builders keep
        // working untouched. That column is @unique, so an admin who once hand-typed
        // this exact number on ANOTHER company makes this throw P2002. Do not fail the
        // attach for that: the number is bought and SupportNumber is the authority.
        // Losing the mirror only costs the number in an email signature.
        try {
          await tx.company.update({
            where: { id: companyId },
            data: { supportNumber: purchased.phoneNumber },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            this.logger.error(
              `Company.supportNumber mirror failed for company ${companyId}: ` +
                `${purchased.phoneNumber} is already typed on another company. ` +
                `Clear that stale value; the number itself is attached correctly.`,
            );
          } else {
            throw err;
          }
        }

        return row;
      });
    } catch (err) {
      // Compensating release. Without this, a failed DB write leaves us paying for a
      // number nothing references, forever.
      this.logger.error(
        `PHONE ORPHAN companyId=${companyId} sid=${purchased.sid} ` +
          `number=${purchased.phoneNumber} — attach failed, releasing`,
      );
      try {
        await this.signalwire.releaseNumber(purchased.sid);
      } catch {
        this.logger.error(
          `PHONE ORPHAN companyId=${companyId} sid=${purchased.sid} ` +
            `number=${purchased.phoneNumber} — RELEASE ALSO FAILED, ` +
            `manual cleanup required in the SignalWire dashboard`,
        );
      }
      throw err;
    }
  }

  /**
   * Releases the company's number. Billing stops at the SignalWire call.
   *
   * Release-then-write, the opposite of attach. If the DB write fails afterwards no
   * money is being wasted, and a retry finds the number already gone (treated as
   * success by SignalWireService) and fixes the row. Idempotent by construction.
   */
  async releaseNumber(companyId: number): Promise<void> {
    const row = await this.getActiveNumber(companyId);
    if (!row) {
      throw new NotFoundException('This company has no support number');
    }

    await this.signalwire.releaseNumber(row.sid);

    await this.prisma.$transaction([
      this.prisma.supportNumber.update({
        where: { id: row.id },
        data: { releasedAt: new Date(), activeForCompanyId: null },
      }),
      this.prisma.company.update({
        where: { id: companyId },
        data: { supportNumber: null },
      }),
    ]);
  }

  /**
   * Registration hook. NEVER throws.
   *
   * `POST /api/companies/register` is public and a completed 40-field wizard submission
   * must not be lost because a third party is down. Every failure path returns an
   * outcome and logs; nothing propagates.
   */
  async autoProvisionForCompany(companyId: number): Promise<ProvisionOutcome> {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          businessName: true,
          country: true,
          isInternal: true,
          deletedAt: true,
        },
      });
      if (!company || company.isInternal || company.deletedAt) {
        return { status: 'skipped', reason: 'not a provisionable company' };
      }

      const iso = toIsoCountry(company.country);
      if (!iso) {
        this.logger.warn(
          `Skipping auto-provision for company ${companyId}: unsupported country ` +
            `"${company.country ?? 'null'}"`,
        );
        return { status: 'skipped', reason: 'unsupported country' };
      }

      if (!(await this.underDailyCap())) {
        this.logger.error(
          `PHONE CAP REACHED — skipping auto-provision for company ${companyId}. ` +
            `Raise PHONE_MAX_PURCHASES_PER_DAY if this is legitimate volume.`,
        );
        return { status: 'skipped', reason: 'daily purchase cap reached' };
      }

      if (await this.getActiveNumber(companyId)) {
        return { status: 'skipped', reason: 'already has a number' };
      }

      const candidates = await this.searchEligible(iso);
      if (candidates.length === 0) {
        this.logger.warn(
          `No voice+SMS-capable ${iso} numbers available for company ${companyId}. ` +
            (iso === 'US'
              ? 'Expected until A2P 10DLC registration completes — US long codes are voice-only until then.'
              : 'Check inventory in PHONE_DEFAULT_REGIONS_CA.'),
        );
        return { status: 'skipped', reason: 'no eligible numbers available' };
      }

      const number = await this.attachNumber(
        companyId,
        candidates[0].phoneNumber,
        candidates[0].region,
      );
      this.logger.log(
        `Auto-provisioned ${number.phoneNumber} for company ${companyId}`,
      );
      return { status: 'attached', number };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Auto-provision failed for company ${companyId}: ${message}`,
      );
      return { status: 'failed', reason: message };
    }
  }

  /**
   * Hard-delete hook. Best-effort release, then drop the history rows.
   *
   * The rows MUST go regardless of what SignalWire says: the fk_support_number_company
   * foreign key would otherwise block deleting the company outright. And a permanent
   * delete must not be blocked by a third-party outage, so a release failure is logged
   * rather than raised — the PHONE ORPHAN line plus the business-name FriendlyName is
   * enough to reclaim the number by hand.
   */
  async purgeForCompany(companyId: number): Promise<void> {
    const active = await this.getActiveNumber(companyId);
    if (active) {
      try {
        await this.signalwire.releaseNumber(active.sid);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `PHONE ORPHAN companyId=${companyId} sid=${active.sid} ` +
            `number=${active.phoneNumber} — release during permanent delete failed ` +
            `(${message}), manual cleanup required`,
        );
      }
    }
    await this.prisma.supportNumber.deleteMany({ where: { companyId } });
  }

  // ── Guards ──────────────────────────────────────────────────────────────────

  private async assertProvisionable(companyId: number) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        businessName: true,
        country: true,
        isInternal: true,
        deletedAt: true,
      },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
    if (company.isInternal) {
      throw new BadRequestException(
        'The Cyg Finance workspace cannot have a phone number',
      );
    }
    return company;
  }

  /** True while today's automatic purchases are under the configured ceiling. */
  private async underDailyCap(): Promise<boolean> {
    const max = maxPurchasesPerDay(process.env);
    if (max <= 0) return false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await this.prisma.supportNumber.count({
      where: { createdAt: { gte: since } },
    });
    return used < max;
  }
}
