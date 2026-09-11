import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertRealCompany } from '../companies/company-target.util.js';
import { toE164 } from '../phone/phone-number.util.js';
import {
  AUTO_SOURCES,
  desiredAutoContacts,
  type AutoContactInput,
} from './auto-contacts.util.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

/** The sentence `assertRealCompany` needs: what THIS feature does not do for a workspace. */
const INTERNAL_MESSAGE =
  'The Cyg Finance workspace has no phone line, so it has no contacts';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private prisma: PrismaService) {}

  async findByCompany(companyId: number) {
    await assertRealCompany(this.prisma, companyId, INTERNAL_MESSAGE);
    return this.prisma.contact.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async create(dto: CreateContactDto) {
    await assertRealCompany(this.prisma, dto.companyId, INTERNAL_MESSAGE);
    return this.prisma.contact.create({
      data: {
        companyId: dto.companyId,
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        // Derived here and never accepted from the client: it is the field an inbound
        // caller is matched against, so letting a request set it would let a request
        // choose whose name a call displays.
        phoneE164: toE164(dto.phone),
        email: dto.email?.trim() || null,
        note: dto.note?.trim() || null,
        // Hand-made. NULL is what lets these repeat freely — see the schema comment.
        autoSource: null,
      },
    });
  }

  async update(id: number, dto: UpdateContactDto) {
    const existing = await this.getOrThrow(id);
    return this.prisma.contact.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        // phone and phoneE164 move together, always. Updating one without the other is
        // how a contact ends up displaying one number and matching another.
        ...(dto.phone !== undefined && {
          phone: dto.phone.trim(),
          phoneE164: toE164(dto.phone),
        }),
        ...(dto.email !== undefined && { email: dto.email?.trim() || null }),
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
      },
    });
  }

  /**
   * Soft delete, matching `PhoneAudio` and `SignatureImage`.
   *
   * A timeline request in flight may already hold this id, and the rows are small. It also
   * means deleting a seeded contact is not permanent: the next Details-tab save brings it
   * back, which is the correct outcome — the company field it mirrors is still set.
   */
  async remove(id: number) {
    const existing = await this.getOrThrow(id);
    await this.prisma.contact.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The saved name for ONE number, for the ringing popup. Null when nobody saved it.
   *
   * Never throws: an address book that will not load must cost a name on the call card,
   * never the call itself. It is on the inbound-webhook path, where the only acceptable
   * failure mode is "show the number".
   */
  async nameForNumber(
    companyId: number,
    rawNumber: string,
  ): Promise<string | null> {
    const e164 = toE164(rawNumber);
    if (!e164) return null;
    try {
      const row = await this.prisma.contact.findFirst({
        where: { companyId, deletedAt: null, phoneE164: e164 },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      return row?.name ?? null;
    } catch (err) {
      this.logger.warn(
        `nameForNumber(${companyId}) failed, the call will show a number: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Reconcile this company's THREE seeded contacts against its own fields. Idempotent.
   *
   * Called from `CompaniesService.register` and `CompaniesService.update`, and by
   * `scripts/backfill-contacts.ts` for companies that predate the feature. Hand-made rows
   * (`autoSource: null`) are never read and never written here.
   *
   * ⚠️ This OVERWRITES a seeded row that somebody has since edited by hand. That is the
   * requested behaviour — changing the accountant's phone on the Details tab must change
   * the contact — and it is why the picker offers a separate hand-made row for anyone who
   * wants different wording.
   */
  async syncAutoContacts(companyId: number): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null, isInternal: false },
      select: {
        contactInfo: {
          select: { personalName: true, privatePhone: true, storeNumber: true },
        },
        accountant: { select: { name: true, phone: true } },
      },
    });
    if (!company) return;

    const desired = desiredAutoContacts(company as AutoContactInput);
    const wanted = new Map(desired.map((d) => [d.autoSource, d]));

    for (const source of AUTO_SOURCES) {
      const seed = wanted.get(source);

      if (!seed) {
        // The field was cleared. Retire the row rather than leaving a number that now
        // belongs to nobody putting a name on incoming calls.
        await this.prisma.contact.updateMany({
          where: { companyId, autoSource: source, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        continue;
      }

      const data = {
        name: seed.name,
        phone: seed.phone,
        phoneE164: toE164(seed.phone),
        // Un-deletes a row somebody removed by hand, deliberately: the company field it
        // mirrors is still set, so the contact is still true.
        deletedAt: null,
      };

      await this.prisma.contact.upsert({
        where: { companyId_autoSource: { companyId, autoSource: source } },
        create: { companyId, autoSource: source, ...data },
        update: data,
      });
    }
  }

  /**
   * `syncAutoContacts`, but it can never fail its caller.
   *
   * Registration is a public 40-field wizard and a Details-tab save is somebody's edit;
   * neither may be lost because a contact row would not write. Same rule
   * `autoProvisionForCompany` and `PhoneSettingsService.effectiveFor` follow.
   */
  async syncAutoContactsQuietly(companyId: number): Promise<void> {
    try {
      await this.syncAutoContacts(companyId);
    } catch (err) {
      this.logger.error(
        `syncAutoContacts failed for company ${companyId}: ${String(err)}`,
      );
    }
  }

  private async getOrThrow(id: number) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }
}
