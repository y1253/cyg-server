import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignatureImageService } from '../signature-image/signature-image.service';
import { EmailSignatureService } from './email-signature.service';
import { SEED_DEFAULTS, SETTINGS_SINGLETON } from './email-signature.util';

const COMPANY = { id: 7, businessName: 'Acme Bookkeeping', isInternal: false };

const GLOBAL_ROW = { id: 1, singleton: SETTINGS_SINGLETON, ...SEED_DEFAULTS };

/**
 * `assertUsableBy` is the real thing's contract, stubbed to a rule rather than a
 * `mockRejectedValue`, so these tests exercise "the service asked, and honoured the
 * answer" rather than restating the predicate — which `signature-image.service.spec.ts`
 * already owns.
 */
function build(
  over: { scopedImageIds?: Record<number, number | null> } = {},
) {
  const owners = over.scopedImageIds ?? {};

  const images = {
    assertUsableBy: jest
      .fn()
      .mockImplementation(async (value: unknown, scope: number | null) => {
        if (typeof value !== 'number' || value <= 0) return;
        const owner = owners[value] ?? null;
        if (owner !== null && owner !== scope) {
          throw new BadRequestException('That logo belongs to another company');
        }
      }),
    urlFor: jest.fn().mockResolvedValue(null),
  } as unknown as SignatureImageService;

  const prisma = {
    emailSignatureDefault: {
      upsert: jest.fn().mockResolvedValue(GLOBAL_ROW),
      update: jest.fn().mockResolvedValue(GLOBAL_ROW),
      findUnique: jest.fn().mockResolvedValue(GLOBAL_ROW),
    },
    companyEmailSignature: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(null),
    },
    company: {
      findFirst: jest.fn().mockResolvedValue(COMPANY),
      // `buildView` -> `companyVars` reads the live fields the tokens substitute.
      findUnique: jest.fn().mockResolvedValue({
        businessName: COMPANY.businessName,
        supportNumber: '+14382561210',
        billing: { billingEmail: 'billing@acme.test' },
        accountant: null,
      }),
    },
  } as unknown as PrismaService;

  return { prisma, images, service: new EmailSignatureService(prisma, images) };
}

describe('updateForCompany — cross-scope integrity', () => {
  it('rejects a logo owned by ANOTHER company, and writes nothing', async () => {
    // "A rejected save writes nothing" is the property worth pinning: the check has to sit
    // ahead of the upsert, not merely somewhere in the method.
    const { prisma, service } = build({ scopedImageIds: { 5: 8 } });
    await expect(
      service.updateForCompany(7, { signatureImageId: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.companyEmailSignature.upsert).not.toHaveBeenCalled();
  });

  it("accepts this company's own logo", async () => {
    const { prisma, service } = build({ scopedImageIds: { 5: 7 } });
    await service.updateForCompany(7, { signatureImageId: 5 });
    expect(prisma.companyEmailSignature.upsert).toHaveBeenCalled();
  });

  it('accepts a firm-wide logo', async () => {
    const { prisma, service } = build({ scopedImageIds: { 5: null } });
    await service.updateForCompany(7, { signatureImageId: 5 });
    expect(prisma.companyEmailSignature.upsert).toHaveBeenCalled();
  });

  it('validates an explicit null (inherit) rather than skipping it', async () => {
    // `null` means "clear the override" and is a VALUE, so it reaches the check and
    // trivially passes. What must NOT happen is it being treated as absent.
    const { images, service } = build();
    await service.updateForCompany(7, { signatureImageId: null });
    expect(images.assertUsableBy).toHaveBeenCalledWith(null, 7);
  });

  it('does not validate an ABSENT key — that means "leave alone"', async () => {
    const { images, service } = build();
    await service.updateForCompany(7, { signatureHtml: '<div>hi</div>' });
    expect(images.assertUsableBy).not.toHaveBeenCalled();
  });
});

describe('updateDefaults — the firm-wide scope', () => {
  it('rejects a company-scoped logo as the default, and writes nothing', async () => {
    const { prisma, service } = build({ scopedImageIds: { 5: 7 } });
    await expect(
      service.updateDefaults({ signatureImageId: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.emailSignatureDefault.update).not.toHaveBeenCalled();
  });

  it('asks with the firm-wide scope, which is null and not a company id', async () => {
    const { images, service } = build({ scopedImageIds: { 5: null } });
    await service.updateDefaults({ signatureImageId: 5 });
    expect(images.assertUsableBy).toHaveBeenCalledWith(5, null);
  });
});

describe('resetForCompany', () => {
  it('needs no scope check — it writes nulls', async () => {
    const { images, prisma, service } = build();
    await service.resetForCompany(7);
    expect(images.assertUsableBy).not.toHaveBeenCalled();
    expect(prisma.companyEmailSignature.upsert).toHaveBeenCalled();
  });
});

describe('preview', () => {
  it('scopes the logo lookup so it cannot tease a logo a save would refuse', async () => {
    const { images, service } = build();
    await service.preview('<div>{logo}</div>', 7, 5);
    expect(images.urlFor).toHaveBeenCalledWith(5, 7);
  });

  it('passes the firm-wide scope when previewing without a company', async () => {
    const { images, service } = build();
    await service.preview('<div>{logo}</div>', undefined, 5);
    expect(images.urlFor).toHaveBeenCalledWith(5, null);
  });

  it('renders rather than throwing when the logo is out of scope', async () => {
    // `urlFor` filters to null; preview must still return html. A preview that 500s while
    // somebody is typing is worse than one that shows less.
    const { service } = build();
    await expect(
      service.preview('<div>{logo}</div>', 7, 5),
    ).resolves.toHaveProperty('html', expect.any(String));
  });
});
