import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignatureImageService } from '../signature-image/signature-image.service.js';
import { assertRealCompany } from '../companies/company-target.util.js';
import {
  EffectiveEmailSignature,
  EmailSignatureOverrides,
  HARDCODED_FALLBACK,
  RawSignatureDefaults,
  RawSignatureOverrides,
  SEED_DEFAULTS,
  SETTINGS_SINGLETON,
  SIGNATURE_FIELDS,
  SignatureSource,
  resolveSignature,
} from './email-signature.util.js';
import {
  PLACEHOLDERS,
  renderSignature,
  sanitizeSignatureHtml,
  type SignatureVars,
} from './signature-template.util.js';
import { UpdateSignatureDefaultsDto } from './dto/update-signature-defaults.dto.js';
import { UpdateCompanyEmailSignatureDto } from './dto/update-company-signature.dto.js';

/** Everything the per-company card needs, in one response. */
export interface CompanyEmailSignatureView {
  companyId: number;
  companyName: string;
  /** RAW, as stored — nulls intact, so the UI knows which boxes are ticked. */
  overrides: EmailSignatureOverrides;
  effective: EffectiveEmailSignature;
  source: SignatureSource;
  /** The globals, so "Use default" previews render without a second fetch. */
  defaults: EffectiveEmailSignature;
  placeholders: typeof PLACEHOLDERS;
  /** The effective template rendered against this company — what staff will actually see. */
  previewHtml: string;
}

@Injectable()
export class EmailSignatureService {
  private readonly logger = new Logger(EmailSignatureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: SignatureImageService,
  ) {}

  // ── Defaults ──────────────────────────────────────────────────────────────

  /**
   * The global row, created on first read.
   *
   * `update: {}` is load-bearing: reading the settings must never revert an admin's edits.
   * Same upsert as `PhoneSettingsService.getDefaults`.
   */
  async getDefaults() {
    return this.prisma.emailSignatureDefault.upsert({
      where: { singleton: SETTINGS_SINGLETON },
      update: {},
      create: { singleton: SETTINGS_SINGLETON, ...SEED_DEFAULTS },
    });
  }

  async updateDefaults(dto: UpdateSignatureDefaultsDto) {
    await this.getDefaults(); // ensure the row exists before updating it
    const data = this.pickPresent(dto);
    // Before the write, so a rejected save leaves the row untouched. `null` = the
    // firm-wide scope, which is what refuses a logo uploaded inside some company: it
    // would then be mailed out by every OTHER company that inherits the default.
    await this.assertImageInScope(data, null);
    return this.prisma.emailSignatureDefault.update({
      where: { singleton: SETTINGS_SINGLETON },
      data,
    });
  }

  // ── Per company ───────────────────────────────────────────────────────────

  async getForCompany(companyId: number): Promise<CompanyEmailSignatureView> {
    const company = await this.assertCompany(companyId);
    const [globalRow, overrideRow] = await Promise.all([
      this.getDefaults(),
      this.prisma.companyEmailSignature.findUnique({ where: { companyId } }),
    ]);
    return this.buildView(company, globalRow, overrideRow);
  }

  async updateForCompany(
    companyId: number,
    dto: UpdateCompanyEmailSignatureDto,
  ): Promise<CompanyEmailSignatureView> {
    const company = await this.assertCompany(companyId);
    const data = this.pickPresent(dto);
    // Before the upsert, and before the Promise.all that contains it — a save that names
    // another company's logo must write nothing at all.
    await this.assertImageInScope(data, companyId);
    const [globalRow, overrideRow] = await Promise.all([
      this.getDefaults(),
      this.prisma.companyEmailSignature.upsert({
        where: { companyId },
        update: data,
        create: { companyId, ...data },
      }),
    ]);
    return this.buildView(company, globalRow, overrideRow);
  }

  /**
   * Every field back to inheriting.
   *
   * Nulls the columns rather than deleting the row: `createdAt` records when this company
   * was first customised, which is worth keeping, and an upsert on a just-deleted row races
   * with a concurrent read.
   */
  async resetForCompany(
    companyId: number,
  ): Promise<CompanyEmailSignatureView> {
    const company = await this.assertCompany(companyId);
    const cleared = Object.fromEntries(
      SIGNATURE_FIELDS.map((key) => [key, null]),
    ) as Record<string, null>;
    const [globalRow, overrideRow] = await Promise.all([
      this.getDefaults(),
      this.prisma.companyEmailSignature.upsert({
        where: { companyId },
        update: cleared,
        create: { companyId, ...cleared },
      }),
    ]);
    return this.buildView(company, globalRow, overrideRow);
  }

  // ── The hot path ──────────────────────────────────────────────────────────

  /**
   * The signature this company should send, ready to seed into an editor.
   *
   * **Never throws.** This answers `getAccount`, so a settings outage must degrade to the
   * built-in signature rather than 500 the whole Communications tab — the same rule
   * `PhoneSettingsService.effectiveFor` follows, and for the same reason.
   *
   * Note it uses `findUnique`, not `getDefaults()`: the hot path must not write.
   */
  async renderForCompany(companyId: number): Promise<string> {
    try {
      const [globalRow, overrideRow, company] = await Promise.all([
        this.prisma.emailSignatureDefault.findUnique({
          where: { singleton: SETTINGS_SINGLETON },
        }),
        this.prisma.companyEmailSignature.findUnique({ where: { companyId } }),
        this.companyVars(companyId),
      ]);
      const { effective } = resolveSignature(
        globalRow as RawSignatureDefaults | null,
        overrideRow as RawSignatureOverrides | null,
      );
      // "" means this company sends no signature -- a value, not an absence.
      if (!effective.signatureHtml) return '';
      const logoUrl = await this.images.urlFor(effective.signatureImageId);
      return this.wrap(
        renderSignature(effective.signatureHtml, { ...company, logoUrl }),
      );
    } catch (error) {
      this.logger.error(
        `email signature lookup failed for company ${companyId} — ` +
          `falling back to the built-in signature: ${String(error)}`,
      );
      return this.wrap(
        renderSignature(HARDCODED_FALLBACK.signatureHtml, {
          ...(await this.companyVars(companyId).catch(() => EMPTY_VARS)),
          logoUrl: null,
        }),
      );
    }
  }

  /** "What would this look like?" — renders an unsaved template, stores nothing. */
  async preview(
    template: string,
    companyId?: number,
    signatureImageId?: number,
  ): Promise<{ html: string }> {
    const vars = companyId
      ? await this.companyVars(companyId).catch(() => SAMPLE_VARS)
      : SAMPLE_VARS;
    // Scoped, unlike every other `urlFor` call: this is an UNSAVED pick, so previewing a
    // logo that `assertImageInScope` would then refuse to save would tease the admin with
    // an outcome they cannot have. It filters to no-logo rather than throwing — a preview
    // that 500s while somebody types is worse than one that shows less.
    const logoUrl = await this.images.urlFor(
      signatureImageId,
      companyId ?? null,
    );
    return {
      html: this.wrap(
        renderSignature(sanitizeSignatureHtml(template), { ...vars, logoUrl }),
      ),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * The marker wrapper.
   *
   * ⚠️ `data-cyg-signature="1"` must stay on the FIRST attribute-bearing top-level div and
   * everything the signature renders must be INSIDE it. `splitSignature`
   * (client `message-utils.ts`) is a raw regex search for
   * `<div[^>]*data-cyg-(signature|forward)`, not a DOM parse — anything emitted above or
   * outside this div lands on the "user's own prose" side and gets fed to the AI polisher.
   */
  private wrap(html: string): string {
    return `<div data-cyg-signature="1">${html}</div>`;
  }

  /** The token values for one company. */
  private async companyVars(
    companyId: number,
  ): Promise<Omit<SignatureVars, 'logoUrl'>> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        businessName: true,
        supportNumber: true,
        billing: { select: { billingEmail: true } },
        accountant: {
          select: { name: true, email: true, phone: true },
        },
      },
    });
    return {
      company: company?.businessName ?? '',
      phone: company?.supportNumber ?? '',
      email: company?.billing?.billingEmail ?? '',
      accountant: company?.accountant?.name ?? '',
      accountantemail: company?.accountant?.email ?? '',
      accountantphone: company?.accountant?.phone ?? '',
    };
  }

  /**
   * DTO → Prisma data, keeping ONLY the keys the request actually carried.
   *
   * `hasOwnProperty`, never truthiness. An absent key means "leave it alone"; an explicit
   * `null` means "clear this override"; and `0` and `''` are override VALUES.
   * `Object.entries(dto).filter(([, v]) => v)` silently drops both of those and is the bug
   * this method exists to prevent.
   *
   * Iterating `SIGNATURE_FIELDS` rather than the DTO's own keys is the second half: a field
   * added to the model and the DTO but not to that list would never be saved, and the list
   * is shared with the resolver, so the omission shows up in both places at once.
   */
  private pickPresent(
    dto: UpdateSignatureDefaultsDto | UpdateCompanyEmailSignatureDto,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const key of SIGNATURE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(dto, key)) continue;
      const value = (dto as Record<string, unknown>)[key];
      if (value === undefined) continue;
      // Sanitised on the way IN, so a stored template is safe for every later reader —
      // including the composer's contentEditable, which is the one that matters.
      data[key] =
        key === 'signatureHtml' && typeof value === 'string'
          ? sanitizeSignatureHtml(value)
          : value;
    }
    return data;
  }

  /**
   * Kept as a private wrapper over the shared helper rather than inlining it at the four
   * call sites, so the sentence this feature shows stays in one place.
   */
  /**
   * Refuse a save that names a logo this scope cannot use.
   *
   * `hasOwnProperty` on the MAPPED data, not on the dto, so it obeys the same
   * absent-vs-null rule as `pickPresent` that produced it: an absent key means "leave
   * alone" and must not be validated, while an explicit `null` ("inherit") is validated and
   * trivially passes.
   */
  private async assertImageInScope(
    data: Record<string, unknown>,
    scope: number | null,
  ): Promise<void> {
    if (!Object.prototype.hasOwnProperty.call(data, 'signatureImageId')) return;
    await this.images.assertUsableBy(data.signatureImageId, scope);
  }

  private assertCompany(companyId: number) {
    return assertRealCompany(
      this.prisma,
      companyId,
      'Internal workspaces send no email and have no signature',
    );
  }

  private async buildView(
    company: { id: number; businessName: string },
    globalRow: RawSignatureDefaults,
    overrideRow: RawSignatureOverrides | null,
  ): Promise<CompanyEmailSignatureView> {
    const { effective, source } = resolveSignature(globalRow, overrideRow);
    // Run through the SAME resolver rather than read off the row, so `defaults` carries
    // exactly the normalisation `effective` does.
    const defaults = resolveSignature(globalRow, null).effective;

    // Rebuilt from SIGNATURE_FIELDS so `id`/`companyId`/timestamps never leak, and every
    // key is present-with-null even when no override row exists.
    const overrides = Object.fromEntries(
      SIGNATURE_FIELDS.map((key) => [key, overrideRow?.[key] ?? null]),
    ) as EmailSignatureOverrides;

    const [vars, logoUrl] = await Promise.all([
      this.companyVars(company.id),
      this.images.urlFor(effective.signatureImageId),
    ]);

    return {
      companyId: company.id,
      companyName: company.businessName,
      overrides,
      effective,
      source,
      defaults,
      placeholders: PLACEHOLDERS,
      previewHtml: effective.signatureHtml
        ? renderSignature(effective.signatureHtml, { ...vars, logoUrl })
        : '',
    };
  }
}

const EMPTY_VARS: Omit<SignatureVars, 'logoUrl'> = {
  company: '',
  phone: '',
  email: '',
  accountant: '',
  accountantemail: '',
  accountantphone: '',
};

/** Sample values for a preview with no company behind it, from PLACEHOLDERS itself. */
const SAMPLE_VARS: Omit<SignatureVars, 'logoUrl'> = {
  company: 'Acme Bookkeeping',
  phone: '+1 438 256 1210',
  email: 'billing@acme.com',
  accountant: 'Dana Levy',
  accountantemail: 'dana@cygfinance.com',
  accountantphone: '+1 514 555 0100',
};
