import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { describeToday, isOpenAt } from './phone-hours.util.js';
import { PLACEHOLDERS, renderMessage } from './phone-message.util.js';
import {
  HARDCODED_FALLBACK,
  SEED_DEFAULTS,
  SETTINGS_FIELDS,
  SETTINGS_SINGLETON,
  resolveSettings,
  type EffectivePhoneSettings,
  type PhoneSettingsOverrides,
  type RawDefaults,
  type RawOverrides,
  type SettingsSource,
} from './phone-settings.util.js';
import type { UpdateCompanyPhoneSettingsDto } from './dto/update-company-phone-settings.dto.js';
import type { UpdatePhoneDefaultsDto } from './dto/update-phone-defaults.dto.js';

/** What the admin UI needs to render one company's card in a single round trip. */
export interface CompanyPhoneSettingsView {
  companyId: number;
  companyName: string;
  /** RAW, as stored — nulls intact, so the UI knows which boxes are ticked. */
  overrides: PhoneSettingsOverrides;
  effective: EffectivePhoneSettings;
  source: SettingsSource;
  /** The globals, so "Use default" previews render without a second fetch. */
  defaults: EffectivePhoneSettings;
  isOpenNow: boolean;
  hoursToday: string;
  placeholders: typeof PLACEHOLDERS;
}

@Injectable()
export class PhoneSettingsService {
  private readonly logger = new Logger(PhoneSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Global defaults ──────────────────────────────────────────────────────────

  /**
   * The one global row, created with the seeded defaults if it is missing.
   *
   * Self-healing rather than throwing: a database that was never seeded must still serve
   * the admin page and answer calls. `update: {}` means calling this never touches an
   * existing row — the same reason the seed uses it.
   */
  async getDefaults() {
    return this.prisma.phoneSettingsDefault.upsert({
      where: { singleton: SETTINGS_SINGLETON },
      update: {},
      create: {
        singleton: SETTINGS_SINGLETON,
        ...SEED_DEFAULTS,
        weeklyHours: SEED_DEFAULTS.weeklyHours,
      },
    });
  }

  async updateDefaults(dto: UpdatePhoneDefaultsDto) {
    await this.getDefaults(); // ensure the row exists before updating it
    const data = this.pickPresent(dto);
    return this.prisma.phoneSettingsDefault.update({
      where: { singleton: SETTINGS_SINGLETON },
      data,
    });
  }

  // ── Per-company overrides ────────────────────────────────────────────────────

  async getForCompany(companyId: number): Promise<CompanyPhoneSettingsView> {
    const company = await this.assertCompany(companyId);
    const [globalRow, overrideRow] = await Promise.all([
      this.getDefaults(),
      this.prisma.companyPhoneSettings.findUnique({ where: { companyId } }),
    ]);
    return this.buildView(company, globalRow, overrideRow);
  }

  async updateForCompany(
    companyId: number,
    dto: UpdateCompanyPhoneSettingsDto,
  ): Promise<CompanyPhoneSettingsView> {
    const company = await this.assertCompany(companyId);
    const data = this.pickPresent(dto);
    const [globalRow, overrideRow] = await Promise.all([
      this.getDefaults(),
      this.prisma.companyPhoneSettings.upsert({
        where: { companyId },
        update: data,
        create: { companyId, ...data },
      }),
    ]);
    return this.buildView(company, globalRow, overrideRow);
  }

  /**
   * Clear every override, so the company inherits the defaults again.
   *
   * Sets every column to NULL rather than deleting the row: `createdAt` records when this
   * company was first customised, which is worth keeping, and an upsert on a
   * just-deleted row races with a concurrent read.
   */
  async resetForCompany(companyId: number): Promise<CompanyPhoneSettingsView> {
    const company = await this.assertCompany(companyId);
    const cleared = Object.fromEntries(
      SETTINGS_FIELDS.map((key) => [key, null]),
    ) as Record<string, null>;
    const [globalRow, overrideRow] = await Promise.all([
      this.getDefaults(),
      this.prisma.companyPhoneSettings.upsert({
        where: { companyId },
        update: cleared,
        create: { companyId, ...cleared },
      }),
    ]);
    return this.buildView(company, globalRow, overrideRow);
  }

  // ── The call path ────────────────────────────────────────────────────────────

  /**
   * The settings the inbound webhook acts on. **NEVER THROWS.**
   *
   * A settings outage must not become a dead phone line, so any failure logs and falls
   * back to `HARDCODED_FALLBACK` — whose `hoursEnabled: false` means a degraded lookup
   * rings the phone rather than silently telling every caller we are closed. Same rule as
   * `autoProvisionForCompany`: the public path never dies on a dependency.
   *
   * `companyId` is nullable because an inbound call to an unknown number still needs a
   * message to play.
   */
  async effectiveFor(companyId: number | null): Promise<EffectivePhoneSettings> {
    try {
      const [globalRow, overrideRow] = await Promise.all([
        this.prisma.phoneSettingsDefault.findUnique({
          where: { singleton: SETTINGS_SINGLETON },
        }),
        companyId === null
          ? Promise.resolve(null)
          : this.prisma.companyPhoneSettings.findUnique({ where: { companyId } }),
      ]);
      return resolveSettings(
        globalRow as RawDefaults | null,
        overrideRow as RawOverrides | null,
      ).effective;
    } catch (error) {
      this.logger.error(
        `phone settings lookup failed for company ${companyId ?? 'unknown'} — ` +
          `falling back to built-in defaults: ${String(error)}`,
      );
      return HARDCODED_FALLBACK;
    }
  }

  // ── Preview ──────────────────────────────────────────────────────────────────

  async preview(template: string, companyId?: number, at?: string) {
    const when = at ? new Date(at) : new Date();
    const instant = Number.isNaN(when.getTime()) ? new Date() : when;

    let companyName = 'Acme Bookkeeping';
    let phone = '+14382561210';
    if (companyId !== undefined) {
      const company = await this.prisma.company.findFirst({
        where: { id: companyId, deletedAt: null },
        select: { businessName: true, supportNumber: true },
      });
      if (company) {
        companyName = company.businessName;
        phone = company.supportNumber ?? phone;
      }
    }

    const settings = await this.effectiveFor(companyId ?? null);
    return {
      text: renderMessage(template, {
        company: companyName,
        phone,
        hours: describeToday(settings.weeklyHours, settings.timezone, instant),
      }),
      isOpen: isOpenAt(settings.weeklyHours, settings.timezone, instant),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * DTO → Prisma data, keeping ONLY the keys the request actually carried.
   *
   * `hasOwnProperty`, never truthiness. An absent key means "leave it alone"; an explicit
   * `null` means "clear this override"; and `false` / `0` / `''` are override VALUES.
   * `Object.entries(dto).filter(([, v]) => v)` silently drops all three of those and is
   * the bug this method exists to prevent.
   *
   * Iterating `SETTINGS_FIELDS` rather than the DTO's own keys is the second half: a
   * field added to the model and the DTO but not to that list would never be saved, and
   * the list is shared with the resolver, so the omission shows up in both places at once.
   */
  private pickPresent(
    dto: UpdatePhoneDefaultsDto | UpdateCompanyPhoneSettingsDto,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const key of SETTINGS_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(dto, key)) continue;
      const value = (dto as Record<string, unknown>)[key];
      if (value === undefined) continue;
      data[key] =
        key === 'weeklyHours' && value === null
          ? Prisma.DbNull
          : (value as Prisma.InputJsonValue);
    }
    return data;
  }

  /**
   * A real, live, non-internal company.
   *
   * Internal "Cyg Finance" workspaces are excluded the way `assertNotInternal` excludes
   * them elsewhere: they have no support number and nobody can call them, so phone
   * settings on one would be a form that configures nothing.
   */
  private async assertCompany(companyId: number) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true, businessName: true, isInternal: true, supportNumber: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    if (company.isInternal) {
      throw new BadRequestException(
        'Internal workspaces have no phone line and no phone settings',
      );
    }
    return company;
  }

  private buildView(
    company: { id: number; businessName: string },
    globalRow: RawDefaults,
    overrideRow: RawOverrides | null,
  ): CompanyPhoneSettingsView {
    const { effective, source } = resolveSettings(globalRow, overrideRow);
    const defaults = resolveSettings(globalRow, null).effective;
    const now = new Date();

    const overrides = Object.fromEntries(
      SETTINGS_FIELDS.map((key) => [key, overrideRow?.[key] ?? null]),
    ) as PhoneSettingsOverrides;

    return {
      companyId: company.id,
      companyName: company.businessName,
      overrides,
      effective,
      source,
      defaults,
      // Computed HERE, not in the browser: the viewer's timezone is not the company's,
      // and a client-side reimplementation would be a second copy of the rule that
      // decides whether a call gets answered.
      isOpenNow: isOpenAt(effective.weeklyHours, effective.timezone, now),
      hoursToday: describeToday(effective.weeklyHours, effective.timezone, now),
      placeholders: PLACEHOLDERS,
    };
  }
}
