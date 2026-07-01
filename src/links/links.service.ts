import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from '../common/crypto.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';

@Injectable()
export class LinksService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLinkDto) {
    const encKey = process.env.ENCRYPTION_KEY;
    const { password, ...rest } = dto;
    const link = await this.prisma.link.create({
      data: {
        ...rest,
        password: password && encKey ? encrypt(password, encKey) : null,
      },
    });
    return this.decryptLink(link);
  }

  async update(id: number, dto: UpdateLinkDto) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');

    const encKey = process.env.ENCRYPTION_KEY;
    const { password, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    // Only touch password when the field is present in the payload:
    //   non-empty ⇒ encrypt & store, empty string ⇒ clear (null), absent ⇒ leave.
    if (password !== undefined) {
      data.password = password && encKey ? encrypt(password, encKey) : null;
    }

    const updated = await this.prisma.link.update({ where: { id }, data });
    return this.decryptLink(updated);
  }

  async remove(id: number) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await this.prisma.link.delete({ where: { id } });
  }

  async findByCompany(companyId: number) {
    const links = await this.prisma.link.findMany({ where: { companyId } });
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
