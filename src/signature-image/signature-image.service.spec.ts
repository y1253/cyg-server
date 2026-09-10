import { BadRequestException, NotFoundException } from '@nestjs/common';

// `create` genuinely writes the encoded PNG to disk. Mocked, or every run of this spec
// litters UPLOADS_DIR/signature-images/ with orphan files that nothing ever cleans up —
// the module deliberately never unlinks.
jest.mock('fs/promises', () => ({ writeFile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./signature-image.storage.js', () => {
  const actual = jest.requireActual('./signature-image.storage.js');
  return { ...actual, ensureSignatureImageDir: jest.fn() };
});

import type { PrismaService } from '../prisma/prisma.service';
import { SignatureImageService } from './signature-image.service';
import { MAX_COMPANY_LOGOS } from './signature-image.util';

const COMPANY = { id: 7, businessName: 'Acme Bookkeeping', isInternal: false };

/** A 1x1 PNG, so sharp has real bytes to decode. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const FILE = { buffer: PNG, originalname: 'acme.png' };

/** A stored row — firm-wide unless a companyId is given. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Acme logo',
    publicId: 'pub-uuid',
    filename: 'acme.png',
    mimeType: 'image/png',
    size: 1234,
    width: 200,
    height: 80,
    storagePath: 'signature-images/x.png',
    uploadedById: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    companyId: null,
    ...over,
  };
}

function build(
  over: {
    found?: Record<string, unknown> | null;
    count?: number;
    company?: typeof COMPANY | null;
  } = {},
) {
  const prisma = {
    signatureImage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest
        .fn()
        .mockResolvedValue(over.found === undefined ? row() : over.found),
      count: jest.fn().mockResolvedValue(over.count ?? 0),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          row(data),
        ),
      update: jest.fn().mockResolvedValue(row()),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.company === undefined ? COMPANY : over.company),
    },
  } as unknown as PrismaService;
  return { prisma, service: new SignatureImageService(prisma) };
}

describe('list', () => {
  it('asks for firm-wide rows only by default — the ADMIN library', async () => {
    const { prisma, service } = build();
    await service.list();
    expect(prisma.signatureImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, companyId: null } }),
    );
  });

  it('asks for firm-wide PLUS this company when scoped', async () => {
    const { prisma, service } = build();
    await service.list(7);
    expect(prisma.signatureImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [{ companyId: null }, { companyId: 7 }],
        },
      }),
    );
  });

  it('projects companyId, and still never leaks storagePath or publicId', async () => {
    const { prisma, service } = build();
    (prisma.signatureImage.findMany as jest.Mock).mockResolvedValue([
      row({ companyId: 7 }),
    ]);
    const [view] = await service.list(7);
    expect(view.companyId).toBe(7);
    expect(view).not.toHaveProperty('storagePath');
    expect(view).not.toHaveProperty('publicId');
  });
});

describe('create', () => {
  it('stamps companyId on a scoped upload', async () => {
    const { prisma, service } = build();
    await service.create(FILE, 'Acme', 1, 7);
    expect(prisma.signatureImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 7 }),
      }),
    );
  });

  it('leaves companyId null on a firm-wide upload', async () => {
    const { prisma, service } = build();
    await service.create(FILE, 'Acme', 1);
    expect(prisma.signatureImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: null }),
      }),
    );
  });

  it('refuses past the per-company ceiling, and writes no row', async () => {
    const { prisma, service } = build({ count: MAX_COMPANY_LOGOS });
    await expect(service.create(FILE, 'Acme', 1, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.signatureImage.create).not.toHaveBeenCalled();
  });

  it('does NOT apply the ceiling to the firm-wide library', async () => {
    const { prisma, service } = build({ count: MAX_COMPANY_LOGOS });
    await service.create(FILE, 'Acme', 1);
    expect(prisma.signatureImage.count).not.toHaveBeenCalled();
    expect(prisma.signatureImage.create).toHaveBeenCalled();
  });

  it('404s before writing anything when the company is gone', async () => {
    const { prisma, service } = build({ company: null });
    await expect(service.create(FILE, 'Acme', 1, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.signatureImage.create).not.toHaveBeenCalled();
  });
});

describe('rename / remove gate on isImageInLibrary, not on visibility', () => {
  it('404s when a company renames a FIRM-WIDE logo it can see', async () => {
    // The gap between the two predicates, exercised: this logo IS in company 7's picker.
    const { prisma, service } = build({ found: row({ companyId: null }) });
    await expect(service.rename(1, 'Mine', 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.signatureImage.update).not.toHaveBeenCalled();
  });

  it("404s when a company deletes another company's logo", async () => {
    const { prisma, service } = build({ found: row({ companyId: 8 }) });
    await expect(service.remove(1, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.signatureImage.update).not.toHaveBeenCalled();
  });

  it('allows a company to rename its own logo', async () => {
    const { prisma, service } = build({ found: row({ companyId: 7 }) });
    await service.rename(1, 'Mine', 7);
    expect(prisma.signatureImage.update).toHaveBeenCalled();
  });

  it('THE TIGHTENING: the admin route can no longer delete a scoped logo', async () => {
    // `DELETE /signature-images/:id` could previously delete any row; it now refuses
    // anything it does not list. Affects zero pre-existing rows, all of which are
    // firm-wide.
    const { service } = build({ found: row({ companyId: 7 }) });
    await expect(service.remove(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft-deletes, never hard-deletes', async () => {
    const { prisma, service } = build({ found: row({ companyId: 7 }) });
    await service.remove(1, 7);
    expect(prisma.signatureImage.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
  });
});

describe('assertUsableBy', () => {
  it('passes the sentinels through with no query at all', async () => {
    const { prisma, service } = build();
    await expect(service.assertUsableBy(0, 7)).resolves.toBeUndefined();
    await expect(service.assertUsableBy(null, 7)).resolves.toBeUndefined();
    await expect(service.assertUsableBy(undefined, 7)).resolves.toBeUndefined();
    expect(prisma.signatureImage.findFirst).not.toHaveBeenCalled();
  });

  it('accepts a firm-wide logo for a company', async () => {
    const { service } = build({ found: row({ companyId: null }) });
    await expect(service.assertUsableBy(5, 7)).resolves.toBeUndefined();
  });

  it('accepts a company own logo', async () => {
    const { service } = build({ found: row({ companyId: 7 }) });
    await expect(service.assertUsableBy(5, 7)).resolves.toBeUndefined();
  });

  it("rejects another company's logo", async () => {
    const { service } = build({ found: row({ companyId: 8 }) });
    await expect(service.assertUsableBy(5, 7)).rejects.toThrow(
      /belongs to another company/,
    );
  });

  it('rejects a company logo as the FIRM-WIDE default', async () => {
    // The reverse direction, and the one that keeps a per-company upload out of every
    // other company's inherited signature.
    const { service } = build({ found: row({ companyId: 7 }) });
    await expect(service.assertUsableBy(5, null)).rejects.toThrow(
      /cannot be the firm-wide default/,
    );
  });

  it('rejects a deleted id with a sentence an admin can act on', async () => {
    const { service } = build({ found: null });
    await expect(service.assertUsableBy(5, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('urlFor stays the never-throws hot path', () => {
  it('does NOT scope-check unless asked', async () => {
    const { prisma, service } = build({ found: { publicId: 'pub' } });
    await service.urlFor(5);
    expect(prisma.signatureImage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, deletedAt: null } }),
    );
  });

  it('scopes when a scope is passed — the preview path', async () => {
    const { prisma, service } = build({ found: { publicId: 'pub' } });
    await service.urlFor(5, 7);
    expect(prisma.signatureImage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 5,
          deletedAt: null,
          OR: [{ companyId: null }, { companyId: 7 }],
        },
      }),
    );
  });

  it('returns null rather than throwing when the row is gone', async () => {
    const { service } = build({ found: null });
    await expect(service.urlFor(5)).resolves.toBeNull();
  });

  it('returns null rather than throwing when the database is down', async () => {
    const { prisma, service } = build();
    (prisma.signatureImage.findFirst as jest.Mock).mockRejectedValue(
      new Error('db down'),
    );
    await expect(service.urlFor(5)).resolves.toBeNull();
  });
});
