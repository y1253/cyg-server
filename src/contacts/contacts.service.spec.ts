import { ContactsService } from './contacts.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * `syncAutoContacts` is the half of this feature that can silently do the wrong thing:
 * it WRITES over rows on every Details-tab save. These pin which rows it may touch,
 * which it must leave alone, and what "the field was cleared" does.
 */
function setup(company: unknown) {
  const upsert = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    company: { findFirst: jest.fn().mockResolvedValue(company) },
    contact: { upsert, updateMany },
  } as unknown as PrismaService;
  return { svc: new ContactsService(prisma), upsert, updateMany, prisma };
}

const FULL = {
  contactInfo: {
    personalName: 'Dana Fisher',
    privatePhone: '(438) 256-1210',
    storeNumber: null,
  },
  accountant: { name: 'Sam Ortiz', phone: '5145550199' },
};

describe('ContactsService.syncAutoContacts', () => {
  it('writes one row per filled source and normalises the number for matching', async () => {
    const { svc, upsert, updateMany } = setup(FULL);
    await svc.syncAutoContacts(1);

    expect(upsert).toHaveBeenCalledTimes(2);
    const owner = upsert.mock.calls[0][0];
    expect(owner.where).toEqual({
      companyId_autoSource: { companyId: 1, autoSource: 'OWNER' },
    });
    expect(owner.create).toMatchObject({
      companyId: 1,
      autoSource: 'OWNER',
      name: 'Dana Fisher',
      phone: '(438) 256-1210',
      // The display value stays as typed; only this one is normalised.
      phoneE164: '+14382561210',
    });
    // STORE had no number, so it is retired rather than written.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 1, autoSource: 'STORE', deletedAt: null },
      }),
    );
  });

  it('is idempotent — a second run writes exactly the same thing', async () => {
    const { svc, upsert } = setup(FULL);
    await svc.syncAutoContacts(1);
    const first = JSON.stringify(upsert.mock.calls);
    upsert.mockClear();
    await svc.syncAutoContacts(1);
    expect(JSON.stringify(upsert.mock.calls)).toBe(first);
  });

  it('soft-deletes a source whose phone was cleared, and never hard-deletes', async () => {
    const { svc, upsert, updateMany } = setup({
      contactInfo: { personalName: 'Dana Fisher', privatePhone: null, storeNumber: null },
      accountant: { name: 'Sam Ortiz', phone: null },
    });
    await svc.syncAutoContacts(1);

    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(3);
    for (const [arg] of updateMany.mock.calls) {
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
    }
  });

  it('only ever touches rows with an autoSource, never a hand-made contact', async () => {
    const { svc, upsert, updateMany } = setup(FULL);
    await svc.syncAutoContacts(1);

    // A hand-made row is `autoSource: null`. Every write here names a source explicitly,
    // so no query this method issues can select one.
    for (const [arg] of upsert.mock.calls) {
      expect(arg.where.companyId_autoSource.autoSource).toBeTruthy();
    }
    for (const [arg] of updateMany.mock.calls) {
      expect(arg.where.autoSource).toBeTruthy();
    }
  });

  it('revives a seeded row somebody deleted by hand, because the field is still set', async () => {
    const { svc, upsert } = setup(FULL);
    await svc.syncAutoContacts(1);
    for (const [arg] of upsert.mock.calls) {
      expect(arg.update.deletedAt).toBeNull();
    }
  });

  it('stores a null phoneE164 rather than refusing an unmatched number', async () => {
    const { svc, upsert } = setup({
      contactInfo: { personalName: 'Dana', privatePhone: 'ext. 4021', storeNumber: null },
      accountant: null,
    });
    await svc.syncAutoContacts(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      phone: 'ext. 4021',
      phoneE164: null,
    });
  });

  it('does nothing at all for an internal workspace or a deleted company', async () => {
    // The findFirst filters on `isInternal: false, deletedAt: null`, so both arrive here
    // as "no row" — and neither may produce a write.
    const { svc, upsert, updateMany } = setup(null);
    await svc.syncAutoContacts(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('ContactsService.syncAutoContactsQuietly', () => {
  it('swallows a failure, so a contact row can never cost somebody their save', async () => {
    const prisma = {
      company: { findFirst: jest.fn().mockRejectedValue(new Error('db is down')) },
      contact: {},
    } as unknown as PrismaService;
    const svc = new ContactsService(prisma);
    jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined);

    await expect(svc.syncAutoContactsQuietly(1)).resolves.toBeUndefined();
    expect(svc['logger'].error).toHaveBeenCalled();
  });
});
