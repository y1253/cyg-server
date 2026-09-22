import { CallRoutingService } from './call-routing.service';
import type { PrismaService } from '../prisma/prisma.service';

const TO = '+14382561210';

function makeService(opts: {
  number?: { companyId: number } | null;
  company?: {
    id: number;
    businessName: string;
    assignments: {
      userId: number;
      user?: { phoneE164: string | null; deletedAt: Date | null } | null;
    }[];
  } | null;
  admins?: { id: number }[];
}) {
  const prisma = {
    supportNumber: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.number === undefined ? { companyId: 90 } : opts.number,
        ),
    },
    company: {
      findFirst: jest.fn().mockResolvedValue(
        opts.company === undefined
          ? {
              id: 90,
              businessName: 'St. Paul',
              assignments: [
                {
                  userId: 16,
                  user: { phoneE164: null, deletedAt: null },
                },
              ],
            }
          : opts.company,
      ),
    },
    user: { findMany: jest.fn().mockResolvedValue(opts.admins ?? []) },
  };
  return {
    service: new CallRoutingService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('CallRoutingService.resolve', () => {
  it('rings the assigned user, and only them', async () => {
    // The core of steps.md: a call for a company reaches the person responsible for it.
    const { service } = makeService({});
    await expect(service.resolve(TO)).resolves.toEqual({
      companyId: 90,
      companyName: 'St. Paul',
      targetUserIds: [16],
      targetPhones: [],
      viaAdminFallback: false,
    });
  });

  it('returns the assignee mobile so the inbound <Dial> can also ring it', async () => {
    const { service } = makeService({
      company: {
        id: 90,
        businessName: 'St. Paul',
        assignments: [
          { userId: 16, user: { phoneE164: '+15145550123', deletedAt: null } },
        ],
      },
    });
    await expect(service.resolve(TO)).resolves.toMatchObject({
      targetPhones: [{ userId: 16, e164: '+15145550123' }],
    });
  });

  it('takes the mobile from the assignment query, without a second round trip', async () => {
    // The whole point of widening the existing select rather than adding a lookup: this
    // runs on the inbound webhook, where every query is latency before the phone rings.
    const { service, prisma } = makeService({});
    await service.resolve(TO);
    expect(prisma.company.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('rings no mobile for a user who has no number on file', async () => {
    const { service } = makeService({});
    await expect(service.resolve(TO)).resolves.toMatchObject({
      targetUserIds: [16],
      targetPhones: [],
    });
  });

  it('never dials a SOFT-DELETED assignee, though it still broadcasts to their id', async () => {
    // The asymmetry is deliberate: pushing an SSE event at a deleted user's id is inert,
    // whereas dialling their mobile rings somebody who no longer works here.
    const { service } = makeService({
      company: {
        id: 90,
        businessName: 'St. Paul',
        assignments: [
          {
            userId: 16,
            user: { phoneE164: '+15145550123', deletedAt: new Date() },
          },
        ],
      },
    });
    await expect(service.resolve(TO)).resolves.toMatchObject({
      targetUserIds: [16],
      targetPhones: [],
    });
  });

  it('drops a malformed stored number rather than putting it in a <Number> noun', async () => {
    const { service } = makeService({
      company: {
        id: 90,
        businessName: 'St. Paul',
        assignments: [
          { userId: 16, user: { phoneE164: '514-555-0123', deletedAt: null } },
        ],
      },
    });
    await expect(service.resolve(TO)).resolves.toMatchObject({
      targetPhones: [],
    });
  });

  it('does NOT fall back to admins when someone is assigned', async () => {
    // The negative half of the same requirement: an admin who is not assigned must not
    // be interrupted by a call somebody else is responsible for.
    const { service, prisma } = makeService({ admins: [{ id: 1 }, { id: 7 }] });
    const route = await service.resolve(TO);
    expect(route?.targetUserIds).toEqual([16]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('falls back to every admin when the company has no assignee', async () => {
    const { service } = makeService({
      company: { id: 90, businessName: 'St. Paul', assignments: [] },
      admins: [{ id: 1 }, { id: 7 }, { id: 13 }],
    });
    await expect(service.resolve(TO)).resolves.toMatchObject({
      targetUserIds: [1, 7, 13],
      viaAdminFallback: true,
    });
  });

  it('rings NO mobile on the admin fallback, even if every admin has one', async () => {
    // Deliberate, and the regression worth naming: the fallback means "put this in front
    // of everyone who could pick it up", which is a screen to glance at. Ringing every
    // admin's PERSONAL phone for every unassigned company is a different proposition, and
    // the remedy is the one the fallback already documents -- assign the company.
    const { service } = makeService({
      company: { id: 90, businessName: 'St. Paul', assignments: [] },
      admins: [{ id: 1 }, { id: 7 }],
    });
    await expect(service.resolve(TO)).resolves.toMatchObject({
      viaAdminFallback: true,
      targetPhones: [],
    });
  });

  it('excludes deleted users from the admin fallback', async () => {
    const { service, prisma } = makeService({
      company: { id: 90, businessName: 'St. Paul', assignments: [] },
      admins: [{ id: 1 }],
    });
    await service.resolve(TO);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it('returns null for a number that belongs to no company', async () => {
    // The caller turns null into a holding message. Connecting an unknown caller to
    // silence is the one outcome that must never happen.
    const { service } = makeService({ number: null });
    await expect(service.resolve('+15145550000')).resolves.toBeNull();
  });

  it('returns null when the company is soft-deleted', async () => {
    const { service } = makeService({ company: null });
    await expect(service.resolve(TO)).resolves.toBeNull();
  });

  it('ignores RELEASED numbers and takes the newest row', async () => {
    // `phoneNumber` is not unique on SupportNumber: carriers resell numbers, so a
    // released row can carry the same value as a live one. Routing off a released row
    // would ring the previous owner's company.
    const { service, prisma } = makeService({});
    await service.resolve(TO);
    expect(prisma.supportNumber.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phoneNumber: TO, releasedAt: null },
        orderBy: { id: 'desc' },
      }),
    );
  });

  it('looks the number up on SupportNumber, never on Company.supportNumber', async () => {
    // That column is an admin-editable mirror whose write is allowed to fail silently;
    // SupportNumber is documented as the authority.
    const { service, prisma } = makeService({});
    await service.resolve(TO);
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 90, deletedAt: null }),
      }),
    );
  });
});
