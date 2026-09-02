import { PhoneSettingsService } from './phone-settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  FALLBACK_WEEK,
  HARDCODED_FALLBACK,
  SEED_DEFAULTS,
  SETTINGS_SINGLETON,
} from './phone-settings.util';

const GLOBAL_ROW = {
  id: 1,
  singleton: SETTINGS_SINGLETON,
  ...SEED_DEFAULTS,
  weeklyHours: FALLBACK_WEEK,
};

const COMPANY = {
  id: 90,
  businessName: 'Acme Bookkeeping',
  isInternal: false,
  supportNumber: '+14382561210',
};

function build(over: {
  company?: typeof COMPANY | null;
  overrideRow?: Record<string, unknown> | null;
  failGlobalRead?: boolean;
} = {}) {
  const prisma = {
    phoneSettingsDefault: {
      upsert: jest.fn().mockResolvedValue(GLOBAL_ROW),
      update: jest.fn().mockResolvedValue(GLOBAL_ROW),
      findUnique: over.failGlobalRead
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue(GLOBAL_ROW),
    },
    companyPhoneSettings: {
      findUnique: jest.fn().mockResolvedValue(over.overrideRow ?? null),
      upsert: jest.fn().mockResolvedValue(over.overrideRow ?? null),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.company === undefined ? COMPANY : over.company),
    },
  };
  return {
    service: new PhoneSettingsService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('getDefaults', () => {
  it('self-heals a missing row instead of throwing, and never overwrites an existing one', () => {
    // `update: {}` is load-bearing: reading the settings must not revert an admin's edits.
    const { service, prisma } = build();
    void service.getDefaults();
    expect(prisma.phoneSettingsDefault.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { singleton: SETTINGS_SINGLETON },
        update: {},
      }),
    );
  });
});

describe('updateForCompany — absent vs null vs value', () => {
  it('CLEARS an override sent explicitly as null', async () => {
    const { service, prisma } = build();
    await service.updateForCompany(90, { greetingMessage: null });
    expect(prisma.companyPhoneSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { greetingMessage: null } }),
    );
  });

  it('LEAVES ALONE a field the request did not mention', async () => {
    const { service, prisma } = build();
    await service.updateForCompany(90, { greetingMessage: 'hi' });
    const call = prisma.companyPhoneSettings.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(call.update).toEqual({ greetingMessage: 'hi' });
    expect('afterHoursMessage' in call.update).toBe(false);
  });

  // ── The three values a truthiness filter would silently drop. ──

  it('writes an overriding FALSE', async () => {
    const { service, prisma } = build();
    await service.updateForCompany(90, { playGreeting: false });
    expect(prisma.companyPhoneSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { playGreeting: false } }),
    );
  });

  it('writes an overriding 0', async () => {
    const { service, prisma } = build();
    await service.updateForCompany(90, { ringTimeoutSeconds: 0 });
    expect(prisma.companyPhoneSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { ringTimeoutSeconds: 0 } }),
    );
  });

  it('writes an overriding empty string', async () => {
    const { service, prisma } = build();
    await service.updateForCompany(90, { voice: '' });
    expect(prisma.companyPhoneSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { voice: '' } }),
    );
  });

  it('ignores a field that is not a real setting', async () => {
    const { service, prisma } = build();
    await service.updateForCompany(90, {
      greetingMessage: 'hi',
      hacked: true,
    } as never);
    const call = prisma.companyPhoneSettings.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect('hacked' in call.update).toBe(false);
  });
});

describe('getForCompany', () => {
  it('returns overrides, effective values, the defaults behind them, and the source', async () => {
    const { service } = build({
      overrideRow: { greetingMessage: 'company greeting', playGreeting: false },
    });
    const view = await service.getForCompany(90);

    expect(view.overrides.greetingMessage).toBe('company greeting');
    expect(view.overrides.afterHoursMessage).toBeNull();
    expect(view.effective.greetingMessage).toBe('company greeting');
    expect(view.effective.playGreeting).toBe(false);
    expect(view.effective.afterHoursMessage).toBe(SEED_DEFAULTS.afterHoursMessage);
    expect(view.defaults.greetingMessage).toBe(SEED_DEFAULTS.greetingMessage);
    expect(view.source.greetingMessage).toBe('company');
    expect(view.source.afterHoursMessage).toBe('default');
    expect(typeof view.isOpenNow).toBe('boolean');
  });

  it('404s an unknown company', async () => {
    const { service } = build({ company: null });
    await expect(service.getForCompany(90)).rejects.toThrow('Company not found');
  });

  it('refuses an internal workspace, which has no phone line', async () => {
    const { service } = build({ company: { ...COMPANY, isInternal: true } });
    await expect(service.getForCompany(90)).rejects.toThrow(
      'Internal workspaces have no phone line',
    );
  });
});

describe('resetForCompany', () => {
  it('nulls every field rather than deleting the row', async () => {
    const { service, prisma } = build();
    await service.resetForCompany(90);
    const call = prisma.companyPhoneSettings.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(call.update.greetingMessage).toBeNull();
    expect(call.update.playGreeting).toBeNull();
    expect(call.update.timezone).toBeNull();
  });
});

describe('effectiveFor — the call path', () => {
  it('resolves the company overrides over the globals', async () => {
    const { service } = build({ overrideRow: { afterHoursHangUp: false } });
    const settings = await service.effectiveFor(90);
    expect(settings.afterHoursHangUp).toBe(false);
    expect(settings.greetingMessage).toBe(SEED_DEFAULTS.greetingMessage);
  });

  it('skips the company read entirely for an unknown number', async () => {
    const { service, prisma } = build();
    await service.effectiveFor(null);
    expect(prisma.companyPhoneSettings.findUnique).not.toHaveBeenCalled();
  });

  it('NEVER THROWS — a settings outage must not become a dead phone line', async () => {
    const { service } = build({ failGlobalRead: true });
    await expect(service.effectiveFor(90)).resolves.toEqual(HARDCODED_FALLBACK);
  });

  it('falls back with hours DISABLED, so a degraded lookup rings rather than reporting closed', async () => {
    const { service } = build({ failGlobalRead: true });
    expect((await service.effectiveFor(90)).hoursEnabled).toBe(false);
  });
});
