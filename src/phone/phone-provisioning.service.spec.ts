import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';
import { PhoneProvisioningService } from './phone-provisioning.service';
import type { AvailableNumber } from './signalwire-parse';

const COMPANY = {
  id: 7,
  businessName: 'Acme Bookkeeping',
  country: 'CANADA',
  isInternal: false,
  deletedAt: null,
};

function available(over: Partial<AvailableNumber> = {}): AvailableNumber {
  return {
    phoneNumber: '+14382560856',
    friendlyName: '+1 (438) 256-0856',
    region: 'QC',
    rateCenter: 'MONTREAL',
    locality: null,
    voice: true,
    sms: true,
    mms: true,
    ...over,
  };
}

function purchased(over: Record<string, unknown> = {}) {
  return {
    sid: 'sid-1',
    phoneNumber: '+14382560856',
    friendlyName: 'Acme Bookkeeping',
    voiceUrl: null,
    smsUrl: null,
    voice: true,
    sms: true,
    mms: true,
    capabilitiesRaw: '{"voice":true,"sms":true,"mms":true}',
    ...over,
  };
}

function makeHarness(opts: { company?: unknown; activeRow?: unknown } = {}) {
  const tx = {
    supportNumber: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 1, ...data }),
      ),
    },
    company: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    supportNumber: {
      findFirst: jest.fn().mockResolvedValue(opts.activeRow ?? null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    company: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.company === undefined ? COMPANY : opts.company),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => Promise<unknown>)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  const signalwire = {
    searchAvailable: jest.fn().mockResolvedValue([available()]),
    purchaseNumber: jest.fn().mockResolvedValue(purchased()),
    releaseNumber: jest.fn().mockResolvedValue(undefined),
  };

  const service = new PhoneProvisioningService(
    prisma as unknown as PrismaService,
    signalwire as unknown as SignalWireService,
  );

  return { service, prisma, signalwire, tx };
}

describe('attachNumber spends money only after every cheap guard has passed', () => {
  it('purchases BEFORE writing the row', async () => {
    // The ordering is the whole safety argument: a row written first would point at a
    // number that might not exist, making the company look provisioned while calls
    // silently fail. Assert the order rather than trusting the reading order.
    const { service, signalwire, tx } = makeHarness();
    await service.attachNumber(7, '+14382560856');

    expect(signalwire.purchaseNumber).toHaveBeenCalled();
    expect(tx.supportNumber.create).toHaveBeenCalled();
    expect(signalwire.purchaseNumber.mock.invocationCallOrder[0]).toBeLessThan(
      tx.supportNumber.create.mock.invocationCallOrder[0],
    );
  });

  it('does not purchase when the company already has an active number', async () => {
    const { service, signalwire } = makeHarness({
      activeRow: { id: 3, sid: 'x' },
    });

    await expect(
      service.attachNumber(7, '+14382560856'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('does not purchase for the internal Cyg Finance workspace', async () => {
    const { service, signalwire } = makeHarness({
      company: { ...COMPANY, isInternal: true },
    });

    await expect(
      service.attachNumber(7, '+14382560856'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('names the number after the company and carries the region onto the row', async () => {
    const { service, signalwire, tx } = makeHarness();
    await service.attachNumber(7, '+14382560856', 'QC');

    expect(signalwire.purchaseNumber).toHaveBeenCalledWith(
      expect.objectContaining({ friendlyName: 'Acme Bookkeeping' }),
    );
    expect(tx.supportNumber.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sid: 'sid-1',
        phoneNumber: '+14382560856',
        region: 'QC',
        activeForCompanyId: 7,
      }) as unknown,
    });
  });

  it('mirrors the number onto Company.supportNumber', async () => {
    // The email-signature builders read that column; losing the mirror silently drops
    // the phone number from every outgoing signature.
    const { service, tx } = makeHarness();
    await service.attachNumber(7, '+14382560856');

    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { supportNumber: '+14382560856' },
    });
  });
});

describe('attachNumber releases the number when it cannot be recorded', () => {
  it('releases when the DB write throws', async () => {
    // Without this compensating release we pay for a number nothing references, for as
    // long as the account exists. Nobody exercises this path by hand.
    const { service, signalwire, tx } = makeHarness();
    tx.supportNumber.create.mockRejectedValue(new Error('db down'));

    await expect(service.attachNumber(7, '+14382560856')).rejects.toThrow(
      'db down',
    );
    expect(signalwire.releaseNumber).toHaveBeenCalledWith('sid-1');
  });

  it('KEEPS a number the purchase response claims is not SMS-capable', async () => {
    // The exact production shape. `POST /IncomingPhoneNumbers` returns this same constant
    // for EVERY number, while `GET /IncomingPhoneNumbers` reports sms:true, mms:true for
    // those same SIDs (verified across 31), agreeing with both the search response and
    // the SignalWire dashboard. The create response's capabilities are junk, so nothing
    // here may gate on them — doing so rejected every number the search had cleared.
    const { service, signalwire, tx } = makeHarness();
    signalwire.purchaseNumber.mockResolvedValue(
      purchased({
        sms: false,
        mms: false,
        capabilitiesRaw: '{"voice":true,"sms":false,"mms":false,"fax":true}',
      }),
    );

    await expect(
      service.attachNumber(7, '+14382560856'),
    ).resolves.toMatchObject({
      phoneNumber: '+14382560856',
    });
    expect(tx.supportNumber.create).toHaveBeenCalled();
    expect(signalwire.releaseNumber).not.toHaveBeenCalled();
  });

  it('KEEPS a number whose capabilities the purchase response did not report', async () => {
    // The regression this whole tri-state exists for. The purchase endpoint's
    // `capabilities` shape has never been observed live, and reading an absent field as
    // `false` made every real buy end in "is not both voice- and SMS-capable" — bought,
    // rejected, released, admin blocked. `eligible()` already cleared this number from
    // the search response; silence here is not evidence against it.
    const { service, signalwire, tx } = makeHarness();
    signalwire.purchaseNumber.mockResolvedValue(
      purchased({ voice: null, sms: null, mms: null, capabilitiesRaw: null }),
    );

    await expect(
      service.attachNumber(7, '+14382560856'),
    ).resolves.toMatchObject({ phoneNumber: '+14382560856' });
    expect(tx.supportNumber.create).toHaveBeenCalled();
    expect(signalwire.releaseNumber).not.toHaveBeenCalled();
  });

  it('KEEPS a number when only one flag is unreported', async () => {
    const { service, signalwire, tx } = makeHarness();
    signalwire.purchaseNumber.mockResolvedValue(
      purchased({ sms: null, capabilitiesRaw: '{"voice":true,"mms":true}' }),
    );

    await expect(
      service.attachNumber(7, '+14382560856'),
    ).resolves.toBeDefined();
    expect(tx.supportNumber.create).toHaveBeenCalled();
    expect(signalwire.releaseNumber).not.toHaveBeenCalled();
  });

  it('still surfaces the original error when the compensating release also fails', async () => {
    const { service, signalwire, tx } = makeHarness();
    tx.supportNumber.create.mockRejectedValue(new Error('db down'));
    signalwire.releaseNumber.mockRejectedValue(new Error('signalwire down'));

    await expect(service.attachNumber(7, '+14382560856')).rejects.toThrow(
      'db down',
    );
  });
});

describe('searchAvailable enforces the voice+SMS bar', () => {
  it('drops numbers that cannot do both', async () => {
    const { service, signalwire } = makeHarness();
    signalwire.searchAvailable.mockResolvedValue([
      available({ phoneNumber: '+12012850929', sms: false }), // a US-style row
      available({ phoneNumber: '+14382560856', sms: true }),
    ]);

    const found = await service.searchAvailable('CANADA');
    expect(found.map((n) => n.phoneNumber)).toEqual(['+14382560856']);
  });

  it('rejects an unsupported country instead of guessing', async () => {
    const { service, signalwire } = makeHarness();
    await expect(service.searchAvailable('MEXICO')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(signalwire.searchAvailable).not.toHaveBeenCalled();
  });

  it('rejects a malformed area code', async () => {
    const { service } = makeHarness();
    await expect(
      service.searchAvailable('CANADA', '051'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an explicit area code overrides the region list rather than widening the search', async () => {
    // The admin asked for a specific place; quietly searching elsewhere would hand
    // them a number in the wrong province.
    const { service, signalwire } = makeHarness();
    await service.searchAvailable('CANADA', '438');

    expect(signalwire.searchAvailable).toHaveBeenCalledTimes(1);
    expect(signalwire.searchAvailable).toHaveBeenCalledWith('CA', {
      areaCode: '438',
    });
  });

  it('walks the region list until one has eligible inventory', async () => {
    const { service, signalwire } = makeHarness();
    signalwire.searchAvailable
      .mockResolvedValueOnce([]) // QC empty
      .mockResolvedValueOnce([available({ region: 'ON' })]); // ON has stock

    const found = await service.searchAvailable('CANADA');
    expect(found).toHaveLength(1);
    expect(signalwire.searchAvailable).toHaveBeenNthCalledWith(1, 'CA', {
      inRegion: 'QC',
    });
    expect(signalwire.searchAvailable).toHaveBeenNthCalledWith(2, 'CA', {
      inRegion: 'ON',
    });
  });
});

describe('autoProvisionForCompany is structurally incapable of throwing', () => {
  // Registration is a PUBLIC endpoint. A completed 40-field wizard submission must
  // never be lost because a third party is unavailable.
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, PHONE_MAX_PURCHASES_PER_DAY: '10' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns failed rather than rejecting when SignalWire throws', async () => {
    const { service, signalwire } = makeHarness();
    signalwire.searchAvailable.mockRejectedValue(new Error('gateway down'));

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('skips a country it does not recognise instead of guessing', async () => {
    const { service, signalwire } = makeHarness({
      company: { ...COMPANY, country: 'MEXICO' },
    });

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'unsupported country',
    });
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('skips when no eligible number exists — the US case until 10DLC lands', async () => {
    const { service, signalwire } = makeHarness({
      company: { ...COMPANY, country: 'USA' },
    });
    // Every US number today is voice-only, so the capability filter empties the list.
    signalwire.searchAvailable.mockResolvedValue([available({ sms: false })]);

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'no eligible numbers available',
    });
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('skips, without purchasing, once the daily cap is reached', async () => {
    const { service, prisma, signalwire } = makeHarness();
    prisma.supportNumber.count.mockResolvedValue(10);

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'daily purchase cap reached',
    });
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('a cap of 0 disables automatic purchasing entirely', async () => {
    process.env.PHONE_MAX_PURCHASES_PER_DAY = '0';
    const { service, signalwire } = makeHarness();

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'skipped',
    });
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('skips the internal workspace', async () => {
    const { service, signalwire } = makeHarness({
      company: { ...COMPANY, isInternal: true },
    });

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'skipped',
    });
    expect(signalwire.purchaseNumber).not.toHaveBeenCalled();
  });

  it('never sends an AreaCode — country-only selection is a deliberate decision', async () => {
    const { service, signalwire } = makeHarness();
    await service.autoProvisionForCompany(7);

    const calls = signalwire.searchAvailable.mock.calls as unknown[][];
    for (const call of calls) {
      expect(call[1]).not.toHaveProperty('areaCode');
    }
  });

  it('attaches the first eligible number on the happy path', async () => {
    const { service, signalwire } = makeHarness();

    await expect(service.autoProvisionForCompany(7)).resolves.toMatchObject({
      status: 'attached',
    });
    expect(signalwire.purchaseNumber).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '+14382560856' }),
    );
  });
});

describe('purgeForCompany always clears the rows', () => {
  it('deletes the history rows even when the release fails', async () => {
    // The fk_support_number_company foreign key would otherwise block deleting the
    // company outright, so a third-party outage must not stop this.
    const { service, prisma, signalwire } = makeHarness({
      activeRow: { id: 3, sid: 'sid-1', phoneNumber: '+14382560856' },
    });
    signalwire.releaseNumber.mockRejectedValue(new Error('signalwire down'));

    await expect(service.purgeForCompany(7)).resolves.toBeUndefined();
    expect(prisma.supportNumber.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 7 },
    });
  });
});
