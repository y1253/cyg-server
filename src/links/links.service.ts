import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from '../common/crypto.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';
import { ReorderLinksDto } from './dto/reorder-links.dto.js';

@Injectable()
export class LinksService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLinkDto) {
    const encKey = process.env.ENCRYPTION_KEY;
    const { password, url, ...rest } = dto;
    // Land at the bottom of the company's list. Without this every new link takes
    // the `sortOrder` default of 0 and ties are broken by id, so a freshly added
    // link would jump above everything the user has already arranged.
    const last = await this.prisma.link.findFirst({
      where: { companyId: dto.companyId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const link = await this.prisma.link.create({
      data: {
        ...rest,
        url: url || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        password: password && encKey ? encrypt(password, encKey) : null,
      },
    });
    return this.decryptLink(link);
  }

  async update(id: number, dto: UpdateLinkDto) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');

    const encKey = process.env.ENCRYPTION_KEY;
    const { password, url, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    // Only touch password when the field is present in the payload:
    //   non-empty ⇒ encrypt & store, empty string ⇒ clear (null), absent ⇒ leave.
    if (password !== undefined) {
      data.password = password && encKey ? encrypt(password, encKey) : null;
    }
    // Same three-state rule for url, so clearing it in the edit form sticks.
    if (url !== undefined) {
      data.url = url || null;
    }

    const updated = await this.prisma.link.update({ where: { id }, data });
    return this.decryptLink(updated);
  }

  /**
   * Persist a drag-reorder: `ids` is the company's links in their new order.
   *
   * Every write is scoped to `companyId` via `updateMany`, so an id belonging to
   * another company matches nothing instead of being silently re-homed. One
   * transaction, so a half-applied order can never be observed.
   */
  async reorder(dto: ReorderLinksDto) {
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.link.updateMany({
          where: { id, companyId: dto.companyId },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.findByCompany(dto.companyId);
  }

  async remove(id: number) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await this.prisma.link.delete({ where: { id } });
  }

  async findByCompany(companyId: number) {
    // Explicit order — without it MySQL is free to return rows in any order, which
    // would make a saved drag-reorder look like it hadn't been saved at all.
    const links = await this.prisma.link.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return links.map((link) => this.decryptLink(link));
  }

  // Decrypt the stored password back to plaintext for the client (any
  // authenticated user may reveal it). Legacy/garbled values degrade to null.
  private decryptLink<T extends { password: string | null }>(link: T): T {
    const encKey = process.env.ENCRYPTION_KEY;
    let password: string | null = null;
    if (link.password && encKey) {
      try {
        password = decrypt(link.password, encKey);
      } catch {
        password = null;
      }
    }
    return { ...link, password };
  }
}
