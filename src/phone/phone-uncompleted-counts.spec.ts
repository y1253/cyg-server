import { PhoneTimelineService } from './phone-timeline.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';
import type { MessageStateService } from '../communications/message-state.service';

/**
 * The phone half of the dashboard's cross-company badge.
 *
 * This is the piece that could not be exercised end to end from a dev machine —
 * SignalWire is unreachable behind the office TLS proxy — so the behaviour that
 * actually protects the account lives here: the sweep must be capped, cached across
 * the 60s dashboard poll, and must OMIT a company it could not read rather than
 * report a confident zero.
 */
describe('PhoneTimelineService.getUncompletedCountsForAll', () => {
  let svc: PhoneTimelineService;
  let findMany: jest.Mock;
  let getCounts: jest.Mock;

  /** The service logs an omitted company; keep the test output readable. */
  function silenceLogger(s: PhoneTimelineService) {
    (s as unknown as { logger: { warn: jest.Mock; log: jest.Mock } }).logger = {
      warn: jest.fn(),
      log: jest.fn(),
    };
  }

  function build(companyIds: number[]) {
    findMany = jest
      .fn()
      .mockResolvedValue(companyIds.map((companyId) => ({ companyId })));
    svc = new PhoneTimelineService(
      { supportNumber: { findMany } } as unknown as PrismaService,
      {} as SignalWireService,
      {} as MessageStateService,
    );
    getCounts = jest.fn();
    (svc as unknown as { getCounts: jest.Mock }).getCounts = getCounts;
    silenceLogger(svc);
    return svc;
  }

  afterEach(() => jest.restoreAllMocks());

  it('keys the map by company id', async () => {
    build([1, 2]);
    getCounts.mockImplementation((id: number) =>
      Promise.resolve({ unread: 0, uncompleted: id * 10 }),
    );
    await expect(svc.getUncompletedCountsForAll()).resolves.toEqual({
      1: 10,
      2: 20,
    });
  });

  it('OMITS a company whose sweep throws — absent is "unknown", not zero', async () => {
    build([1, 2]);
    getCounts.mockImplementation((id: number) =>
      id === 1
        ? Promise.reject(new Error('SignalWire unreachable'))
        : Promise.resolve({ unread: 0, uncompleted: 3 }),
    );
    const map = await svc.getUncompletedCountsForAll();
    expect(map).toEqual({ 2: 3 });
    expect(1 in map).toBe(false); // a zero here would claim "nothing pending"
  });

  it('asks only about companies that hold a live number', async () => {
    build([5]);
    getCounts.mockResolvedValue({ unread: 0, uncompleted: 1 });
    await svc.getUncompletedCountsForAll();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { releasedAt: null } }),
    );
  });

  it('counts a company once even if it holds two live rows', async () => {
    findMany = jest
      .fn()
      .mockResolvedValue([{ companyId: 4 }, { companyId: 4 }]);
    svc = new PhoneTimelineService(
      { supportNumber: { findMany } } as unknown as PrismaService,
      {} as SignalWireService,
      {} as MessageStateService,
    );
    getCounts = jest.fn().mockResolvedValue({ unread: 0, uncompleted: 2 });
    (svc as unknown as { getCounts: jest.Mock }).getCounts = getCounts;
    silenceLogger(svc);

    await expect(svc.getUncompletedCountsForAll()).resolves.toEqual({ 4: 2 });
    expect(getCounts).toHaveBeenCalledTimes(1);
  });

  it('never runs more than the concurrency cap at once', async () => {
    build([1, 2, 3, 4, 5, 6, 7, 8]);
    let live = 0;
    let peak = 0;
    getCounts.mockImplementation(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { unread: 0, uncompleted: 1 };
    });

    await svc.getUncompletedCountsForAll();
    expect(peak).toBeLessThanOrEqual(4); // COUNTS_ALL_CONCURRENCY
    expect(getCounts).toHaveBeenCalledTimes(8);
  });

  it('serves a second call from cache — the 60s poll must not re-sweep', async () => {
    build([1]);
    getCounts.mockResolvedValue({ unread: 0, uncompleted: 7 });

    await svc.getUncompletedCountsForAll();
    await svc.getUncompletedCountsForAll();
    expect(getCounts).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent callers into ONE sweep', async () => {
    // Several signed-in dashboards polling at the same moment. Without the in-flight
    // guard each would start its own sweep and multiply the provider requests.
    build([1, 2]);
    getCounts.mockImplementation(
      () =>
        new Promise((r) =>
          setTimeout(() => r({ unread: 0, uncompleted: 1 }), 10),
        ),
    );

    const [a, b, c] = await Promise.all([
      svc.getUncompletedCountsForAll(),
      svc.getUncompletedCountsForAll(),
      svc.getUncompletedCountsForAll(),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(getCounts).toHaveBeenCalledTimes(2); // once per company, not per caller
  });

  it('re-sweeps once the cache has expired', async () => {
    build([1]);
    getCounts.mockResolvedValue({ unread: 0, uncompleted: 1 });
    await svc.getUncompletedCountsForAll();

    const ttl = (
      PhoneTimelineService as unknown as { COUNTS_ALL_TTL_MS: number }
    ).COUNTS_ALL_TTL_MS;
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ttl + 1);

    await svc.getUncompletedCountsForAll();
    expect(getCounts).toHaveBeenCalledTimes(2);
  });

  it('returns an empty map when no company has a number', async () => {
    build([]);
    await expect(svc.getUncompletedCountsForAll()).resolves.toEqual({});
    expect(getCounts).not.toHaveBeenCalled();
  });
});
