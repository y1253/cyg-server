import { RingGroupService } from './ring-group.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';

/**
 * Typed accessors for a jest mock's recorded arguments.
 *
 * `mock.calls` is `any[][]`, which the project's lint rules reject on sight. Naming the
 * shape once here keeps every assertion below readable instead of scattering casts.
 */
function firstArg<T>(fn: jest.Mock): T {
  return (fn.mock.calls as unknown[][])[0][0] as T;
}
function sidsPassedTo(fn: jest.Mock): string[] {
  return (fn.mock.calls as unknown[][]).map((c) => c[0] as string);
}

const CALL_SID = 'caller-1';
const SUPPORT = '+14382561210';
const MOBILE = '+15145550123';

function build(opts: { legStatus?: string; children?: unknown[] } = {}) {
  let next = 0;
  const signalwire = {
    createCall: jest.fn().mockImplementation(() => {
      next += 1;
      return Promise.resolve({ sid: `leg-${next}` });
    }),
    updateCall: jest.fn().mockResolvedValue(undefined),
    getCall: jest
      .fn()
      .mockResolvedValue({ status: opts.legStatus ?? 'ringing' }),
    // The caller's `<Dial>` child, which is what "the browser is ringing now" looks like
    // from here. Present by default so the tests that are not about timing stay direct.
    listCalls: jest
      .fn()
      .mockResolvedValue(
        opts.children ?? [{ sid: 'sip-child', parentCallSid: CALL_SID }],
      ),
  };
  const prisma = {
    ringGroupAnswer: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const service = new RingGroupService(
    prisma as unknown as PrismaService,
    signalwire as unknown as SignalWireService,
  );
  return { service, signalwire, prisma };
}

function startOne(
  service: RingGroupService,
  phones = [{ userId: 16, e164: MOBILE }],
  hasGreeting = false,
) {
  return service.start({
    callSid: CALL_SID,
    companyId: 90,
    companyName: 'Acme Bookkeeping',
    supportNumber: SUPPORT,
    from: '+15145550001',
    fromName: null,
    phones,
    ringTimeoutSeconds: 30,
    // Default OFF so every test that is not about timing dials straight away; the
    // greeting-wait tests opt in.
    hasGreeting,
  });
}

describe('RingGroupService.start', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://hooks.test';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('dials each mobile FROM the company support number', async () => {
    // ⚠️ The caller ID is the decision this asserts, not an incidental. `POST /Calls`
    // requires a `From` this account owns, so the customer's own number is not available;
    // the company's support number is what names which client's line is ringing on the
    // handset. It is also what forces `staffNumbers` in the timeline.
    const { service, signalwire } = build();
    await startOne(service);

    expect(signalwire.createCall).toHaveBeenCalledTimes(1);
    expect(
      firstArg<{ to: string; from: string }>(signalwire.createCall),
    ).toMatchObject({
      to: MOBILE,
      from: SUPPORT,
    });
  });

  it('hands the mobile a whisper it must accept, not a bare bridge', async () => {
    const { service, signalwire } = build();
    await startOne(service);

    const { laml } = firstArg<{ laml: string }>(signalwire.createCall);
    expect(laml).toContain('<Gather');
    expect(laml).toContain('Press 1 to accept.');
    // The reject path: no keypress falls through the <Gather> to this, ending only this
    // leg. Without it a carrier voicemail answers and swallows the customer.
    expect(laml).toContain('<Hangup/>');
    expect(laml.indexOf('</Gather>')).toBeLessThan(laml.indexOf('<Hangup/>'));
  });

  it('dials every assignee who has a number, and survives one failing', async () => {
    const { service, signalwire } = build();
    signalwire.createCall
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce({ sid: 'leg-2' });

    await startOne(service, [
      { userId: 16, e164: MOBILE },
      { userId: 17, e164: '+15145550999' },
    ]);

    // Both were attempted: one bad number must not cost a colleague their ring.
    expect(signalwire.createCall).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when nobody has a number on file', async () => {
    const { service, signalwire } = build();
    await startOne(service, []);
    expect(signalwire.createCall).not.toHaveBeenCalled();
    expect(service.has(CALL_SID)).toBe(false);
  });

  it('ignores a REPEAT inbound webhook for the same call', async () => {
    // ⚠️ Observed in production: `voice/inbound` was requested twice for one CallSid,
    // nineteen seconds apart, and rang one handset twice. The second `start()` used to
    // overwrite `groups[callSid]`, which ORPHANS the first record — and since
    // `browserAnswered` and `screenAccept` both find the call through that map, the first
    // record's legs became impossible to cancel and rang out their full timeout.
    const { service, signalwire } = build();
    await startOne(service);
    await startOne(service);

    expect(signalwire.createCall).toHaveBeenCalledTimes(1);
  });

  it('cancels a leg that was answered WHILE it was being dialled', async () => {
    // ⚠️ A leg is only cancellable once its sid is known, and `createCall` takes a round
    // trip. A `browserAnswered` landing inside that window used to run `cancelLegs`
    // against an empty list and never look again, so the handset rang out with
    // `answeredBy` already set. The re-check before the loop guards the GREETING wait,
    // which is a different window.
    const { service, signalwire } = build();
    signalwire.createCall.mockImplementation(async () => {
      await service.browserAnswered(CALL_SID);
      return { sid: 'leg-1' };
    });

    await startOne(service);

    expect(signalwire.updateCall).toHaveBeenCalledWith('leg-1', {
      status: 'canceled',
    });
  });
});

describe('RingGroupService — waiting for the greeting to finish', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://hooks.test';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.useRealTimers();
  });

  it('does not dial until the caller dial child leg exists', async () => {
    // The child appearing IS the browser starting to ring. Waiting for it is what makes
    // "in parallel" true — before this the cell rang for the whole length of the greeting
    // while the browser sat silent.
    jest.useFakeTimers();
    const { service, signalwire } = build({ children: [] });

    const started = startOne(service, undefined, true);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(signalwire.createCall).not.toHaveBeenCalled();

    // The greeting ends; SignalWire creates the SIP leg.
    signalwire.listCalls.mockResolvedValue([
      { sid: 'sip-child', parentCallSid: CALL_SID },
    ]);
    await jest.advanceTimersByTimeAsync(2_000);
    await started;

    expect(signalwire.createCall).toHaveBeenCalledTimes(1);
  });

  it('dials immediately when there is no greeting', async () => {
    // `playGreeting: false` emits no <Say> at all, so the <Dial> is already running and a
    // wait would only delay the cell for nothing.
    const { service, signalwire } = build({ children: [] });
    await startOne(service, undefined, false);

    expect(signalwire.listCalls).not.toHaveBeenCalled();
    expect(signalwire.createCall).toHaveBeenCalledTimes(1);
  });

  it('never dials when the <Dial> never starts — the caller hung up', async () => {
    // ⚠️ Deliberately NOT the same outcome as an error. No child after the cap means the
    // dial demonstrably never ran, and ringing a staff member's personal phone for a call
    // that no longer exists is worse than not ringing it.
    jest.useFakeTimers();
    const { service, signalwire } = build({ children: [] });

    const started = startOne(service, undefined, true);
    await jest.advanceTimersByTimeAsync(60_000);
    await started;

    expect(signalwire.createCall).not.toHaveBeenCalled();
  });

  it('dials anyway when SignalWire cannot be asked', async () => {
    // We cannot tell "not yet" from "never", so degrade to the old behaviour — ringing a
    // little early — rather than to not ringing at all.
    const { service, signalwire } = build({ children: [] });
    signalwire.listCalls.mockRejectedValue(new Error('timeout'));

    await startOne(service, undefined, true);

    expect(signalwire.createCall).toHaveBeenCalledTimes(1);
  });

  it('does not dial when a browser answers during the greeting', async () => {
    // `browserAnswered` can only end legs that exist; it cannot cancel one not yet created.
    jest.useFakeTimers();
    const { service, signalwire } = build({ children: [] });

    const started = startOne(service, undefined, true);
    await jest.advanceTimersByTimeAsync(3_000);
    await service.browserAnswered(CALL_SID);

    signalwire.listCalls.mockResolvedValue([
      { sid: 'sip-child', parentCallSid: CALL_SID },
    ]);
    await jest.advanceTimersByTimeAsync(2_000);
    await started;

    expect(signalwire.createCall).not.toHaveBeenCalled();
  });

  it('ignores a leg belonging to a different call', async () => {
    // `ParentCallSid` filtering server-side is conference-probe #3, still unanswered, so
    // the rows are re-filtered here — as every other caller does.
    jest.useFakeTimers();
    const { service, signalwire } = build({
      children: [{ sid: 'someone-else', parentCallSid: 'another-call' }],
    });

    const started = startOne(service, undefined, true);
    await jest.advanceTimersByTimeAsync(60_000);
    await started;

    expect(signalwire.createCall).not.toHaveBeenCalled();
  });
});

describe('RingGroupService.screenAccept', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://hooks.test';
    process.env.PHONE_RECORD_CALLS = '1';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('bridges on 1: the CALLER is moved first, carrying the recording', async () => {
    // ⚠️ Order and `record` are both load-bearing. Redirecting the caller is what ends
    // the <Dial> and stops the browsers ringing, and a redirect DROPS every attribute the
    // previous <Dial> carried — so omitting `record` here silently ends the recording and
    // the AI summary for the rest of the call.
    const { service, signalwire } = build();
    await startOne(service);

    const xml = await service.screenAccept('leg-1', '1');

    const move = (
      signalwire.updateCall.mock.calls as [string, { laml: string }][]
    ).find(([sid]) => sid === CALL_SID);
    expect(move).toBeDefined();
    const [, payload] = move as [string, { laml: string }];
    expect(payload.laml).toContain('<Conference');
    expect(payload.laml).toContain('record="record-from-answer-dual"');
    // The staff member's own document joins the same room.
    expect(xml).toContain('<Conference');
    expect(xml).toContain(payload.laml.match(/>(cyg-[^<]+)</)![1]);
  });

  it('records that the call was answered off-browser', async () => {
    // Without this row `callOutcome` reads the abandoned SIP child and files the one case
    // this whole feature exists for as a MISSED call.
    const { service, prisma } = build();
    await startOne(service);
    await service.screenAccept('leg-1', '1');

    expect(prisma.ringGroupAnswer.upsert).toHaveBeenCalledTimes(1);
    expect(
      firstArg<{ where: unknown; create: unknown }>(
        prisma.ringGroupAnswer.upsert,
      ),
    ).toMatchObject({
      where: { callSid: CALL_SID },
      create: { callSid: CALL_SID, companyId: 90, answeredByUserId: 16 },
    });
  });

  it('hangs up on any other key, without touching the caller', async () => {
    const { service, signalwire } = build();
    await startOne(service);

    const xml = await service.screenAccept('leg-1', '9');

    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Conference');
    expect(signalwire.updateCall).not.toHaveBeenCalled();
  });

  it('refuses to bridge a call a browser has already answered', async () => {
    // The race is real — somebody reaching for their cell as a colleague clicks Answer —
    // and bridging here would drop a second member of staff into a live conversation.
    const { service, signalwire } = build();
    await startOne(service);
    await service.browserAnswered(CALL_SID);
    signalwire.updateCall.mockClear();

    const xml = await service.screenAccept('leg-1', '1');

    expect(xml).toContain('already been answered');
    expect(xml).not.toContain('<Conference');
    expect(signalwire.updateCall).not.toHaveBeenCalled();
  });

  it('says so, rather than failing, when the record is gone', async () => {
    // A restart loses the in-process registry. Dead air on a handset somebody just
    // answered is the worse failure.
    const { service } = build();
    const xml = await service.screenAccept('unknown-leg', '1');
    expect(xml).toContain('no longer available');
  });
});

describe('RingGroupService — ending the legs that lost', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://hooks.test';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('CANCELS a leg still ringing, never completes it', async () => {
    // ⚠️ `completed` on a ringing leg risks SignalWire filing the RING time as its
    // duration, which `callOutcome` then reads as ANSWERED — the bug class this module
    // has already paid for twice.
    const { service, signalwire } = build({ legStatus: 'ringing' });
    await startOne(service);

    await service.browserAnswered(CALL_SID);

    expect(signalwire.updateCall).toHaveBeenCalledWith('leg-1', {
      status: 'canceled',
    });
  });

  it('completes a leg that had already answered the whisper', async () => {
    const { service, signalwire } = build({ legStatus: 'in-progress' });
    await startOne(service);

    await service.browserAnswered(CALL_SID);

    expect(signalwire.updateCall).toHaveBeenCalledWith('leg-1', {
      status: 'completed',
    });
  });

  it('keeps the winning leg and ends only its siblings', async () => {
    const { service, signalwire } = build();
    await startOne(service, [
      { userId: 16, e164: MOBILE },
      { userId: 17, e164: '+15145550999' },
    ]);

    await service.screenAccept('leg-1', '1');

    const ended = sidsPassedTo(signalwire.updateCall).filter(
      (sid) => sid !== CALL_SID,
    );
    expect(ended).toEqual(['leg-2']);
  });
});
