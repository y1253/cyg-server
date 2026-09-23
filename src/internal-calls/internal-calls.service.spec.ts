import { InternalCallsService } from './internal-calls.service';
import { IMPLICITLY_READ_SQL } from './internal-call-read.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from '../phone/signalwire.service';
import type { PhoneEventsService } from '../phone/phone-events.service';
import type { CallSummaryService } from '../phone/call-summary.service';
import type { CallControlService } from '../phone/call-control.service';

/**
 * The arguments a mock was called with, typed.
 *
 * `jest.fn()` is `any`, so `mock.calls[0][0]` is an unchecked access — which the lint
 * rules reject, and rightly: a typo in a field name would silently assert nothing.
 */
function argsOf<T extends unknown[]>(mock: jest.Mock, call = 0): T {
  return mock.mock.calls[call] as T;
}

const JOHN = { id: 7, name: 'John Smith', internalWorkspace: { id: 71 } };
const JACK = { id: 12, name: 'Jack Brown', internalWorkspace: { id: 121 } };

function build(over: { users?: unknown[]; createSid?: string } = {}) {
  const users = over.users ?? [JOHN, JACK];
  let userCall = 0;

  const prisma = {
    user: {
      findFirst: jest.fn().mockImplementation(() => {
        const next = users[userCall];
        userCall += 1;
        return Promise.resolve(next ?? null);
      }),
    },
    internalCall: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const signalwire = {
    createCall: jest
      .fn()
      .mockResolvedValue({ sid: over.createSid ?? 'call-1' }),
    listRecordings: jest.fn().mockResolvedValue([]),
    getCall: jest.fn().mockResolvedValue(null),
    // The child legs backfillPending reads to tell an answered call from a ring-out.
    listCalls: jest.fn().mockResolvedValue([]),
  };
  const events = {
    broadcastOutgoingCall: jest.fn(),
    broadcastIncomingCall: jest.fn(),
  };

  const summaries = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    findForCall: jest.fn().mockResolvedValue(null),
    linesForCalls: jest.fn().mockResolvedValue(new Map<string, string>()),
  };

  const callControl = {
    resolveTarget: jest.fn(),
    blindTransfer: jest.fn(),
  };

  const realtime = { publish: jest.fn() };

  const service = new InternalCallsService(
    prisma as unknown as PrismaService,
    signalwire as unknown as SignalWireService,
    events as unknown as PhoneEventsService,
    summaries as unknown as CallSummaryService,
    callControl as unknown as CallControlService,
    {} as never,
    realtime as never,
  );
  return {
    service,
    prisma,
    signalwire,
    events,
    summaries,
    callControl,
    realtime,
  };
}

describe('InternalCallsService.startCall', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SIP_DOMAIN = 'cyg-abc.sip.signalwire.com';
    process.env.SIGNALWIRE_SIP_USERNAME = 'testcyg';
    process.env.SIGNALWIRE_SIP_PASSWORD = 'pw';
    process.env.PHONE_RECORD_CALLS = '1';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refuses to call yourself', async () => {
    const { service, signalwire } = build();
    await expect(service.startCall(7, 7)).rejects.toThrow(
      'cannot call yourself',
    );
    // The point is that no money is spent and no browser is rung.
    expect(signalwire.createCall).not.toHaveBeenCalled();
  });

  it('503s with a named error when the softphone is unconfigured', async () => {
    delete process.env.SIGNALWIRE_SIP_DOMAIN;
    const { service, signalwire } = build();
    await expect(service.startCall(7, 12)).rejects.toThrow(
      'Softphone is not configured',
    );
    expect(signalwire.createCall).not.toHaveBeenCalled();
  });

  it('404s for a deleted callee before placing anything', async () => {
    const { service, signalwire } = build({ users: [JOHN, null] });
    await expect(service.startCall(7, 12)).rejects.toThrow(
      'no longer available',
    );
    expect(signalwire.createCall).not.toHaveBeenCalled();
  });

  // THE marker. Both legs fork to every registered browser and tryPair does not match on
  // call sid, so without X-Cyg-Call the callee can answer the caller's own leg.
  it('puts X-Cyg-Call on the dialled leg, and the same token in the callee event', async () => {
    const { service, signalwire, events } = build();
    await service.startCall(7, 12);

    const [createArgs] = argsOf<[{ laml: string }]>(signalwire.createCall);
    const laml = createArgs.laml;
    expect(laml).toContain('X-Cyg-Call');

    const [, calleeEvent] = argsOf<[number[], { token?: string }]>(
      events.broadcastIncomingCall,
    );
    expect(calleeEvent.token).toBeTruthy();
    // The header the browser will read must be the token the browser is told to expect.
    expect(laml).toContain(encodeURIComponent(calleeEvent.token!));
  });

  it('does NOT mark the caller leg, so the caller pairs the unmarked INVITE', async () => {
    const { service, events } = build();
    await service.startCall(7, 12);
    const [, callerEvent] = argsOf<[number, { token?: string }]>(
      events.broadcastOutgoingCall,
    );
    expect(callerEvent.token).toBeUndefined();
  });

  it('records the call, so it is attributable afterwards', async () => {
    const { service, prisma } = build({ createSid: 'call-xyz' });
    await service.startCall(7, 12);
    const [created] = argsOf<[{ data: Record<string, unknown> }]>(
      prisma.internalCall.create,
    );
    expect(created.data).toMatchObject({
      callSid: 'call-xyz',
      callerId: 7,
      calleeId: 12,
    });
    // The marker must be persisted too — it is what the callee's browser matches on.
    expect(created.data.token).toBeTruthy();
  });

  // A live, ringing call must not be abandoned to protect a history row.
  it('still returns the call when the history write fails', async () => {
    const { service, prisma } = build();
    prisma.internalCall.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.startCall(7, 12)).resolves.toEqual(
      expect.objectContaining({ callSid: 'call-1' }),
    );
  });

  // Each side sees THEIR OWN workspace and the OTHER person's name; that is what makes
  // the existing overlay render correctly with no changes.
  it('sends each participant their own workspace and the other name', async () => {
    const { service, events } = build();
    await service.startCall(7, 12);

    const [, out] = argsOf<[number, Record<string, unknown>]>(
      events.broadcastOutgoingCall,
    );
    expect(out).toMatchObject({ companyId: 71, companyName: 'Jack Brown' });

    const [userIds, inEvent] = argsOf<[number[], Record<string, unknown>]>(
      events.broadcastIncomingCall,
    );
    expect(userIds).toEqual([12]);
    expect(inEvent).toMatchObject({
      companyId: 121,
      companyName: 'John Smith',
    });
  });

  it('never dials a phone number — both legs are the SIP address', async () => {
    const { service, signalwire } = build();
    await service.startCall(7, 12);
    const [args] = argsOf<[{ to: string; from: string }]>(
      signalwire.createCall,
    );
    expect(args.to.startsWith('sip:')).toBe(true);
    // `from` must not be a company support number, or the call would surface in that
    // company's timeline, which is built from Calls?From={support}.
    expect(args.from.startsWith('sip:')).toBe(true);
  });
});

describe('InternalCallsService.recordings', () => {
  // Participants only — admins included. Matches internal messages, where an admin
  // opening someone else's workspace 404s on purpose.
  it('404s (not 403) for someone who was not on the call', async () => {
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findFirst.mockResolvedValueOnce(null);

    await expect(service.recordings(99, 'call-1')).rejects.toThrow(
      'Call not found',
    );
    // A 403 would confirm the call exists; nothing may be fetched either.
    expect(signalwire.listRecordings).not.toHaveBeenCalled();
  });

  it('mints one playback token per recording for a participant', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findFirst.mockResolvedValueOnce({
      callSid: 'call-1',
      callerId: 7,
      calleeId: 12,
    });
    signalwire.listRecordings.mockResolvedValueOnce([
      {
        sid: 'rec-1',
        durationSec: 42,
        createdAt: Date.now(),
        status: 'completed',
      },
    ]);

    const out = await service.recordings(7, 'call-1');
    expect(out.recordings).toHaveLength(1);
    expect(out.recordings[0].sid).toBe('rec-1');
    expect(out.recordings[0].token).toBeTruthy();
  });
});

describe('InternalCallsService.list', () => {
  it('reports direction relative to the VIEWER, not the row', async () => {
    const row = {
      callSid: 'call-1',
      callerId: 7,
      calleeId: 12,
      startedAt: new Date('2026-09-01T10:00:00Z'),
      status: 'completed',
      durationSec: 30,
      calleeReadAt: null,
      calleeCompletedAt: null,
      caller: { id: 7, name: 'John Smith' },
      callee: { id: 12, name: 'Jack Brown' },
    };

    const a = build();
    a.prisma.internalCall.findMany.mockResolvedValueOnce([row]);
    const forCaller = await a.service.list(7);
    expect(forCaller.calls[0]).toMatchObject({
      direction: 'outbound',
      peer: { id: 12, name: 'Jack Brown' },
      // Yours, so already read and completed -- the `isOwn` rule from internal messages.
      isRead: true,
      isCompleted: true,
    });

    const b = build();
    b.prisma.internalCall.findMany.mockResolvedValueOnce([row]);
    const forCallee = await b.service.list(12);
    expect(forCallee.calls[0]).toMatchObject({
      direction: 'inbound',
      peer: { id: 7, name: 'John Smith' },
      // This row is `completed` with 30s of talk time, i.e. ANSWERED — so it is read by
      // construction: you picked it up and spoke, which is what reading it would mean.
      isRead: true,
      // ...but NOT completed. The company rule is explicit that a call is implicitly read
      // and never implicitly completed, and the pair is what shows the callee side is
      // still the only stateful one.
      isCompleted: false,
    });
  });

  // The reported bug: "internal answered calls come in as unread".
  it('marks an ANSWERED incoming call read, and a MISSED one unread', async () => {
    const base = {
      callerId: 7,
      calleeId: 12,
      startedAt: new Date('2026-09-01T10:00:00Z'),
      calleeReadAt: null,
      calleeCompletedAt: null,
      caller: { id: 7, name: 'John Smith' },
      callee: { id: 12, name: 'Jack Brown' },
    };

    const { service, prisma } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      { ...base, callSid: 'answered', status: 'completed', durationSec: 42 },
      { ...base, callSid: 'missed', status: 'no-answer', durationSec: 0 },
    ]);

    const out = await service.list(12);
    expect(out.calls.map((c) => [c.outcome, c.isRead])).toEqual([
      ['answered', true],
      // The backlog is the colleague nobody reached — this one must still nag.
      ['missed', false],
    ]);
  });

  // `completed` with no talk time is a ring-out the provider still calls completed —
  // the same trap the client-call timeline documents.
  it('treats completed-with-zero-duration as missed', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-1',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date('2026-09-01T10:00:00Z'),
        status: 'completed',
        durationSec: 0,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    expect((await service.list(7)).calls[0].outcome).toBe('missed');
  });

  it('does not backfill a call that could still be ringing', async () => {
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-live',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(), // just now
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    const out = await service.list(7);
    expect(signalwire.getCall).not.toHaveBeenCalled();
    expect(out.calls[0].outcome).toBe('in-progress');
  });

  // The reported bug: "incoming beep that was not answered is showing as answered call".
  // A call-waiting ring nobody picked up was stamped `ringing` at the 35s cutoff, and
  // `outcomeOf` had no LIVE case — so 34s of ring time read as an answered call.
  it('never reports a row stuck in a LIVE status as answered', async () => {
    const { service, prisma, signalwire } = build();
    // Deliberately UNRESOLVABLE, so the row is judged on its stored status alone.
    signalwire.getCall.mockResolvedValue(null);
    for (const status of ['ringing', 'in-progress', 'queued', 'initiated']) {
      prisma.internalCall.findMany.mockResolvedValueOnce([
        {
          callSid: 'call-stuck',
          callerId: 7,
          calleeId: 12,
          startedAt: new Date(Date.now() - 10 * 60_000),
          status,
          durationSec: 34,
          caller: { id: 7, name: 'John Smith' },
          callee: { id: 12, name: 'Jack Brown' },
        },
      ]);
      const out = await service.list(12);
      expect(out.calls[0].outcome).toBe('in-progress');
      expect(out.calls[0].outcome).not.toBe('answered');
    }
  });

  // The other half: such a row used to be frozen forever, because the filter was
  // `status === null` and nothing else in the codebase writes InternalCall.status.
  it('re-asks a row stamped with a LIVE status and settles it', async () => {
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-frozen',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: 'ringing',
        durationSec: 34,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-frozen',
      status: 'completed',
      durationSec: 36,
    });
    signalwire.listCalls.mockResolvedValueOnce([
      { sid: 'kid', parentCallSid: 'call-frozen', status: 'no-answer', durationSec: 36 },
    ]);

    const out = await service.list(12);
    expect(signalwire.getCall).toHaveBeenCalledWith('call-frozen');
    expect(prisma.internalCall.updateMany).toHaveBeenCalled();
    // Nobody reached them, so it goes back to being work owed.
    expect(out.calls[0]).toMatchObject({ outcome: 'missed', isRead: false });
  });

  it('backfills a finished call that was never finalised', async () => {
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-old',
      status: 'completed',
      durationSec: 58,
    });
    // An answered internal call ALWAYS has a child leg — it is a <Dial><Sip>, and the
    // leg is the thing that was answered. The duration that means anything is its.
    signalwire.listCalls.mockResolvedValueOnce([
      { sid: 'kid', parentCallSid: 'call-old', status: 'completed', durationSec: 55 },
    ]);

    const out = await service.list(7);
    expect(signalwire.getCall).toHaveBeenCalledWith('call-old');
    expect(out.calls[0]).toMatchObject({ durationSec: 55, outcome: 'answered' });
    expect(prisma.internalCall.updateMany).toHaveBeenCalled();
  });

  it('calls a finished call with NO child legs missed, not answered', async () => {
    // The root is an outbound-api leg whose <Dial> completed; with no leg to answer,
    // nobody was reached. Falling back to the root here would be the original bug.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-old',
      status: 'completed',
      durationSec: 55,
    });
    signalwire.listCalls.mockResolvedValueOnce([]);

    const out = await service.list(7);
    expect(out.calls[0].outcome).toBe('missed');
  });

  it('does NOT conclude while the child legs may still be materialising', async () => {
    // Inside the grace window the row is left unfinalised so the next read retries —
    // concluding early would stamp a permanent "missed" on a call somebody answered.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-recent',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-recent',
      status: 'completed',
      durationSec: 40,
    });
    signalwire.listCalls.mockResolvedValueOnce([]);

    const out = await service.list(7);
    expect(out.calls[0].outcome).toBe('in-progress');
    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing when the child-leg lookup itself fails', async () => {
    // "Asked and there are none" is MISSED; "could not ask" must stay unfinalised, or
    // one transient provider error permanently marks an answered call missed.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-old',
      status: 'completed',
      durationSec: 55,
    });
    signalwire.listCalls.mockRejectedValueOnce(new Error('SignalWire down'));

    const out = await service.list(7);
    expect(out.calls[0].outcome).toBe('in-progress');
    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  it('calls it MISSED when the root says completed but every child rang out', async () => {
    // THE regression, with the real shape from the live account:
    //   ROOT  d73f72ce  outbound-api  completed  dur=19
    //   child 102a14fe  outbound-dial no-answer  dur=18
    //   child eb256517  outbound-dial no-answer  dur=18
    // The root's <Dial> completes whether or not anybody picks up, and its duration is
    // the RING time — so reading it alone reported "Answered" for every unanswered
    // staff call in the system.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-old',
      status: 'completed',
      durationSec: 19,
    });
    signalwire.listCalls.mockResolvedValueOnce([
      { sid: 'kid-1', parentCallSid: 'call-old', status: 'no-answer', durationSec: 18 },
      { sid: 'kid-2', parentCallSid: 'call-old', status: 'no-answer', durationSec: 18 },
    ]);

    const out = await service.list(7);
    expect(out.calls[0].outcome).toBe('missed');
  });

  it('calls it ANSWERED when one forked child connected', async () => {
    // The other half, and the reason `pickConnectedChild` had to learn about status:
    // the unanswered branch carries a ring time, so "longest leg wins" picked it.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-old',
      status: 'completed',
      durationSec: 26,
    });
    signalwire.listCalls.mockResolvedValueOnce([
      { sid: 'kid-1', parentCallSid: 'call-old', status: 'no-answer', durationSec: 12 },
      { sid: 'kid-2', parentCallSid: 'call-old', status: 'completed', durationSec: 24 },
    ]);

    const out = await service.list(7);
    expect(out.calls[0]).toMatchObject({ outcome: 'answered', durationSec: 24 });
  });

  it('ignores legs whose parent is a different call', async () => {
    // `listCalls` documents that an IGNORED ParentCallSid returns everything rather than
    // erroring, so the in-memory re-filter is what stops another call's answered leg
    // marking this one answered.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockResolvedValueOnce({
      sid: 'call-old',
      status: 'completed',
      durationSec: 19,
    });
    signalwire.listCalls.mockResolvedValueOnce([
      { sid: 'mine', parentCallSid: 'call-old', status: 'no-answer', durationSec: 18 },
      { sid: 'theirs', parentCallSid: 'someone-else', status: 'completed', durationSec: 90 },
    ]);

    const out = await service.list(7);
    expect(out.calls[0].outcome).toBe('missed');
  });

  // A history list that renders without a duration is fine; one that 500s is not.
  it('still lists when the backfill lookup throws', async () => {
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        callSid: 'call-old',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date(Date.now() - 10 * 60_000),
        status: null,
        durationSec: null,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    signalwire.getCall.mockRejectedValueOnce(new Error('SignalWire down'));

    await expect(
      service.list(7).then((r) => r.calls),
    ).resolves.toHaveLength(1);
  });

  it('pages on id desc and hands back the last id as the cursor', async () => {
    const { service, prisma } = build();
    // PAGE_SIZE + 1 rows come back; the extra one is the "there is more" signal and
    // must not be rendered.
    const rows = Array.from({ length: 31 }, (_, i) => ({
      id: 100 - i,
      callSid: `call-${i}`,
      callerId: 7,
      calleeId: 12,
      startedAt: new Date('2026-09-01T10:00:00Z'),
      status: 'completed',
      durationSec: 30,
      caller: { id: 7, name: 'John Smith' },
      callee: { id: 12, name: 'Jack Brown' },
    }));
    prisma.internalCall.findMany.mockResolvedValueOnce(rows);

    const out = await service.list(7);
    expect(out.calls).toHaveLength(30);
    expect(out.nextCursor).toBe(71); // the 30th row's id, not the 31st
    expect(argsOf<[{ orderBy: unknown; take: number }]>(
      prisma.internalCall.findMany,
    )[0]).toMatchObject({ orderBy: { id: 'desc' }, take: 31 });
  });

  it('reports no next page when the extra row is absent', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        id: 5,
        callSid: 'call-1',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date('2026-09-01T10:00:00Z'),
        status: 'completed',
        durationSec: 30,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    await expect(service.list(7)).resolves.toMatchObject({ nextCursor: null });
  });

  // SENT is a mailbox-only folder, exactly as phone items never reach a company's Sent.
  it('asks for nothing at all in SENT', async () => {
    const { service, prisma } = build();
    await service.list(7, 'SENT');
    expect(
      argsOf<[{ where: unknown }]>(prisma.internalCall.findMany)[0].where,
    ).toEqual({ id: -1 });
  });

  it('scopes UNREAD and UNCOMPLETED to the callee side only', async () => {
    const a = build();
    await a.service.list(7, 'UNREAD');
    expect(
      argsOf<[{ where: unknown }]>(a.prisma.internalCall.findMany)[0].where,
      // Callee-side AND not already answered: a call you picked up is read by
      // construction, so listing it here would contradict its own `isRead`.
      // `IMPLICITLY_READ_SQL` is pinned against the function in its own spec.
    ).toEqual({ calleeId: 7, calleeReadAt: null, NOT: IMPLICITLY_READ_SQL });

    const b = build();
    await b.service.list(7, 'UNCOMPLETED');
    expect(
      argsOf<[{ where: unknown }]>(b.prisma.internalCall.findMany)[0].where,
    ).toEqual({ calleeId: 7, calleeCompletedAt: null });
  });

  // A "Recorded" chip is nice to have; the history list is not optional.
  it('still lists when the account-wide recordings sweep throws', async () => {
    const { service, prisma, signalwire } = build();
    signalwire.listRecordings.mockRejectedValueOnce(new Error('SignalWire down'));
    prisma.internalCall.findMany.mockResolvedValueOnce([
      {
        id: 5,
        callSid: 'call-1',
        callerId: 7,
        calleeId: 12,
        startedAt: new Date('2026-09-01T10:00:00Z'),
        status: 'completed',
        durationSec: 30,
        caller: { id: 7, name: 'John Smith' },
        callee: { id: 12, name: 'Jack Brown' },
      },
    ]);
    const out = await service.list(7);
    expect(out.calls[0].hasRecording).toBe(false);
  });
});

describe('InternalCallsService.setState', () => {
  const ROW = {
    id: 5,
    callSid: 'call-1',
    callerId: 7,
    calleeId: 12,
  };

  it('404s for someone who was not on the call, before writing anything', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findFirst.mockResolvedValueOnce(null);
    await expect(service.setState(99, 'call-1', 'read')).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  /**
   * The caller is authorised and still writes nothing — the same shape as a message
   * sender, who has no recipient row to update. Their call already projects as read and
   * completed, so there is nothing the request could have meant.
   */
  it('scopes the write to the callee, so a caller no-ops instead of erroring', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findFirst.mockResolvedValueOnce(ROW);
    await expect(
      service.setState(7, 'call-1', 'complete'),
    ).resolves.toBeUndefined();
    expect(
      argsOf<[{ where: unknown }]>(prisma.internalCall.updateMany)[0].where,
    ).toEqual({ callSid: 'call-1', calleeId: 7 });
  });

  it('clears the column on unread / uncomplete rather than stamping it', async () => {
    const a = build();
    a.prisma.internalCall.findFirst.mockResolvedValueOnce(ROW);
    await a.service.setState(12, 'call-1', 'unread');
    expect(
      argsOf<[{ data: unknown }]>(a.prisma.internalCall.updateMany)[0].data,
    ).toEqual({ calleeReadAt: null });

    const b = build();
    b.prisma.internalCall.findFirst.mockResolvedValueOnce(ROW);
    await b.service.setState(12, 'call-1', 'uncomplete');
    expect(
      argsOf<[{ data: unknown }]>(b.prisma.internalCall.updateMany)[0].data,
    ).toEqual({ calleeCompletedAt: null });
  });
});

/**
 * Settling a staff call from the `<Dial action>` callback, rather than reconstructing it
 * from child legs the next time somebody opens their history.
 *
 * This is the primary path now. `backfillPending` stays as the backstop, and the tests
 * above still pin it — what these add is that the push cannot introduce the failure the
 * backstop was itself rewritten to avoid: a row written ('completed', 0), which
 * `outcomeOf` reads as MISSED through a duration accident and which nothing ever
 * revisits, so an answered conversation is filed as a missed call forever.
 */
describe('InternalCallsService — settling from dial-status', () => {
  const dial = (over: Partial<Record<string, unknown>> = {}) => ({
    callSid: 'call-1',
    dialCallSid: 'child-1',
    dialStatus: 'completed',
    durationSec: 42,
    to: 'sip:cyg_shared@cygfinance.sip.signalwire.com',
    ...over,
  });

  /** Reach the private handler the way the module wires it: through the subject. */
  const settle = async (
    svc: InternalCallsService,
    e: ReturnType<typeof dial>,
  ) => {
    await (
      svc as unknown as {
        settleFromDial: (x: unknown) => Promise<void>;
      }
    ).settleFromDial(e);
  };

  it('writes the provider status and duration straight onto the row', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: null });

    await settle(service, dial());

    const [args] = argsOf<[{ where: unknown; data: Record<string, unknown> }]>(
      prisma.internalCall.updateMany as jest.Mock,
    );
    expect(args.data).toMatchObject({ status: 'completed', durationSec: 42 });
    expect(args.data.endedAt).toBeInstanceOf(Date);
  });

  it('ignores a call that is not a staff call at all', async () => {
    // `dialCompleted$` fires for every dial in the system, company calls included. The
    // findUnique on the (unique) callSid is what makes those a no-op.
    const { service, prisma } = build();
    prisma.internalCall.findUnique.mockResolvedValue(null);

    await settle(service, dial());

    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  it('leaves an already-settled row alone, so a retried callback cannot rewrite it', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: 'no-answer' });

    await settle(service, dial());

    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  it('still settles a row stamped with a LIVE status', async () => {
    // LIVE means "unsettled", not "settled as in-progress" — the distinction that kept
    // 48 production rows frozen before it was made.
    const { service, prisma } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: 'ringing' });

    await settle(service, dial());

    expect(prisma.internalCall.updateMany).toHaveBeenCalled();
  });

  it('records an UNCONNECTED dial with a zero duration and no provider round trip', async () => {
    // Nobody was on the line, so zero is a fact rather than a guess — and asking the
    // dialled leg for a duration it does not have would be a wasted request per miss.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: null });

    await settle(service, dial({ dialStatus: 'no-answer', durationSec: null }));

    const [args] = argsOf<[{ data: Record<string, unknown> }]>(
      prisma.internalCall.updateMany as jest.Mock,
    );
    expect(args.data).toMatchObject({ status: 'no-answer', durationSec: 0 });
    expect(signalwire.getCall).not.toHaveBeenCalled();
  });

  it('asks the dialled leg for the duration when DialCallDuration was not sent', async () => {
    // ⚠️ `DialCallDuration` has never been observed on this account. This fallback is
    // what keeps the feature working if it turns out never to arrive.
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: null });
    signalwire.getCall.mockResolvedValue({ sid: 'child-1', durationSec: 63 });

    await settle(service, dial({ durationSec: null }));

    expect(signalwire.getCall).toHaveBeenCalledWith('child-1');
    const [args] = argsOf<[{ data: Record<string, unknown> }]>(
      prisma.internalCall.updateMany as jest.Mock,
    );
    expect(args.data).toMatchObject({ status: 'completed', durationSec: 63 });
  });

  it('writes NOTHING for a completed dial whose duration cannot be established', async () => {
    // ⚠️ THE test for this whole path. Writing ('completed', 0) here would mark an
    // answered call missed AND unread, permanently — `unsettled()` treats `completed` as
    // settled, so nothing would ever look at the row again. Leaving it alone hands it
    // back to `backfillPending`, which can still reason from the child legs.
    const { service, prisma } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: null });

    await settle(service, dial({ durationSec: null, dialCallSid: null }));

    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing when the dialled-leg lookup itself fails', async () => {
    const { service, prisma, signalwire } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: null });
    signalwire.getCall.mockRejectedValue(new Error('provider down'));

    await settle(service, dial({ durationSec: null }));

    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });

  it('ignores a callback carrying no status at all', async () => {
    const { service, prisma } = build();
    prisma.internalCall.findUnique.mockResolvedValue({ status: null });

    await settle(service, dial({ dialStatus: '' }));

    expect(prisma.internalCall.updateMany).not.toHaveBeenCalled();
  });
});
