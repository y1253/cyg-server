import { InternalCallsService } from './internal-calls.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from '../phone/signalwire.service';
import type { PhoneEventsService } from '../phone/phone-events.service';
import type { CallSummaryService } from '../phone/call-summary.service';

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
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const signalwire = {
    createCall: jest
      .fn()
      .mockResolvedValue({ sid: over.createSid ?? 'call-1' }),
    listRecordings: jest.fn().mockResolvedValue([]),
    getCall: jest.fn().mockResolvedValue(null),
  };
  const events = {
    broadcastOutgoingCall: jest.fn(),
    broadcastIncomingCall: jest.fn(),
  };

  const summaries = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    findForCall: jest.fn().mockResolvedValue(null),
  };

  const service = new InternalCallsService(
    prisma as unknown as PrismaService,
    signalwire as unknown as SignalWireService,
    events as unknown as PhoneEventsService,
    summaries as unknown as CallSummaryService,
  );
  return { service, prisma, signalwire, events, summaries };
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
      caller: { id: 7, name: 'John Smith' },
      callee: { id: 12, name: 'Jack Brown' },
    };

    const a = build();
    a.prisma.internalCall.findMany.mockResolvedValueOnce([row]);
    const forCaller = await a.service.list(7);
    expect(forCaller[0]).toMatchObject({
      direction: 'outbound',
      peer: { id: 12, name: 'Jack Brown' },
    });

    const b = build();
    b.prisma.internalCall.findMany.mockResolvedValueOnce([row]);
    const forCallee = await b.service.list(12);
    expect(forCallee[0]).toMatchObject({
      direction: 'inbound',
      peer: { id: 7, name: 'John Smith' },
    });
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
    expect((await service.list(7))[0].outcome).toBe('missed');
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
    expect(out[0].outcome).toBe('in-progress');
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
      durationSec: 55,
    });

    const out = await service.list(7);
    expect(signalwire.getCall).toHaveBeenCalledWith('call-old');
    expect(out[0]).toMatchObject({ durationSec: 55, outcome: 'answered' });
    expect(prisma.internalCall.updateMany).toHaveBeenCalled();
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

    await expect(service.list(7)).resolves.toHaveLength(1);
  });
});
