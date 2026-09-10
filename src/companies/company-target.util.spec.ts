import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { assertRealCompany } from './company-target.util';

const MESSAGE = 'Internal workspaces send no email and have no signature';

function prismaReturning(row: unknown) {
  return {
    company: { findFirst: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
}

describe('assertRealCompany', () => {
  it('returns the company when it is live and not internal', async () => {
    const row = { id: 7, businessName: 'Acme', isInternal: false };
    await expect(
      assertRealCompany(prismaReturning(row), 7, MESSAGE),
    ).resolves.toEqual(row);
  });

  it('404s when the company does not exist', async () => {
    await expect(
      assertRealCompany(prismaReturning(null), 7, MESSAGE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on a soft-deleted company — the query filters it, so it reads as missing', async () => {
    // The `deletedAt: null` filter is what makes an archived company indistinguishable
    // from one that never existed, which is the behaviour we want: an archived company
    // must not be configurable.
    const prisma = prismaReturning(null);
    await expect(assertRealCompany(prisma, 7, MESSAGE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7, deletedAt: null },
      }),
    );
  });

  it("400s on an internal workspace, using the CALLER'S sentence", async () => {
    // The message is a parameter precisely so each feature can say what it does not do.
    const row = { id: 3, businessName: 'Cyg Finance', isInternal: true };
    await expect(
      assertRealCompany(prismaReturning(row), 3, MESSAGE),
    ).rejects.toThrow(MESSAGE);
    await expect(
      assertRealCompany(prismaReturning(row), 3, MESSAGE),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
