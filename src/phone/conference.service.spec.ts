import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConferenceService } from './conference.service';
import type { CallControlService, CallContext } from './call-control.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';
import type { PhoneEventsService } from './phone-events.service';
import { MAX_ADDED_PARTIES } from './call-legs.util';
import type { SwCall, SwParticipant } from './signalwire-parse';

const ROOT = 'root-leg';
const CHILD = 'child-leg';
const CONF = 'conf-1';
const SUPPORT = '+14382561210';
const REQUESTER = { id: 7, name: 'Sarah Cohen' };

function participant(callSid: string, hold = false): SwParticipant {
  return {
    callSid,
    hold,
    muted: false,
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
  };
}

/**
 * `legs` says which sid is the agent and which is the other party. That is the ONLY
 * thing that varies between call kinds here, and it is exactly what the order tests are
 * about — so it is injected rather than re-derived through `classifyLegs`.
 */
function setup(
  legs: { agentSid: string; peerSid: string },
  opts: {
    participants?: SwParticipant[];
    conferences?: { sid: string; friendlyName: string; status: string }[];
  } = {},
) {
  /** Every provider call, in the order it happened. This is what the order tests read. */
  const order: string[] = [];
  let created = 0;

  const signalwire = {
    updateCall: jest.fn((sid: string, input: Record<string, unknown>) => {
      order.push(
        input.status === 'completed' ? `hangup:${sid}` : `redirect:${sid}`,
      );
      return Promise.resolve();
    }),
    listConferences: jest.fn(() =>
      Promise.resolve(
        opts.conferences ?? [{ sid: CONF, friendlyName: 'cyg-root', status: 'in-progress' }],
      ),
    ),
    listParticipants: jest.fn(() =>
      Promise.resolve(
        opts.participants ?? [
          participant(legs.agentSid),
          participant(legs.peerSid),
        ],
      ),
    ),
    updateParticipant: jest.fn((_c: string, sid: string, i: { hold?: boolean }) => {
      order.push(`${i.hold ? 'hold' : 'unhold'}:${sid}`);
      return Promise.resolve();
    }),
    removeParticipant: jest.fn(() => {
      order.push('remove');
      return Promise.resolve(true);
    }),
    createCall: jest.fn(() => {
      created += 1;
      order.push('create:new');
      return Promise.resolve({ sid: `new-leg-${created}` } as { sid: string });
    }),
    getCall: jest.fn(() => Promise.resolve(null as SwCall | null)),
  };

  const callControl = {
    legsFor: jest.fn(() => Promise.resolve({ rootSid: ROOT, ...legs })),
    resolveTarget: jest.fn(() => Promise.resolve({ id: 9, name: 'David Levy' })),
  };

  const prisma = {
    supportNumber: {
      findFirst: jest.fn(() => Promise.resolve({ phoneNumber: SUPPORT })),
    },
    contact: {
      findFirst: jest.fn(() =>
        Promise.resolve({ name: 'Chris Bailey', phoneE164: '+15145558888' }),
      ),
    },
  };

  const events = { broadcastIncomingCall: jest.fn() };

  const service = new ConferenceService(
    prisma as unknown as PrismaService,
    signalwire as unknown as SignalWireService,
    events as unknown as PhoneEventsService,
    callControl as unknown as CallControlService,
  );
  return { service, signalwire, events, prisma, callControl, order };
}

function ctx(over: Partial<CallContext> = {}): CallContext {
  return {
    rootSid: ROOT,
    kind: 'inbound',
    requester: REQUESTER,
    companyId: 1,
    companyName: 'Acme Bookkeeping',
    ...over,
  };
}

beforeEach(() => {
  process.env.SIGNALWIRE_SIP_DOMAIN = 'cyg.sip.signalwire.com';
  process.env.SIGNALWIRE_SIP_USERNAME = 'testcyg';
  process.env.SIGNALWIRE_SIP_PASSWORD = 'pw';
  process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
});

/**
 * ⚠️ THE test for this feature, and its premise is now the OPPOSITE of what it was.
 *
 * It used to assert `[redirect:CHILD, redirect:ROOT]` — two movers. That shipped and
 * dropped three live calls, because a `<Dial action>` webhook has no no-op response:
 * whatever it returns replaces the leg's document, so the "loser" of the race still
 * emits something, and what it emitted was `<Hangup/>` for the agent's own leg.
 *
 * The rule now is **exactly one document change per leg**. We redirect the CHILD; the
 * ROOT is moved by `voice/dial-status` and by nothing else. The per-kind matrix is kept
 * because the child is a different person in each, and getting that wrong redirects the
 * wrong party without failing loudly.
 */
describe('addCall redirects the CHILD and NEVER the root', () => {
  const kinds: [string, CallContext, { agentSid: string; peerSid: string }][] = [
    ['inbound: the customer is the root, so the AGENT leg is the child',
      ctx({ kind: 'inbound' }), { agentSid: CHILD, peerSid: ROOT }],
    ['outbound: the agent is the root, so the CUSTOMER leg is the child',
      ctx({ kind: 'outbound' }), { agentSid: ROOT, peerSid: CHILD }],
    ['internal as caller: the callee leg is the child',
      ctx({ kind: 'internal', requesterIsCaller: true }), { agentSid: ROOT, peerSid: CHILD }],
    ['internal as callee: the caller leg is the root',
      ctx({ kind: 'internal', requesterIsCaller: false }), { agentSid: CHILD, peerSid: ROOT }],
  ];

  it.each(kinds)('%s', async (_name, context, legs) => {
    const { service, order } = setup(legs);
    const target =
      context.kind === 'internal' ? { userId: 9 } : { phone: '+15145550000' };
    await service.addCall(context, target);

    expect(order.filter((o) => o.startsWith('redirect:'))).toEqual([
      `redirect:${CHILD}`,
    ]);
    // The load-bearing half: a second mover for the root is what ended live calls.
    expect(order).not.toContain(`redirect:${ROOT}`);
  });

  it('never hangs a leg up while opening the room', async () => {
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { phone: '+15145550000' });
    expect(order.some((o) => o.startsWith('hangup:'))).toBe(false);
  });
});

describe('addCall: the full sequence', () => {
  it('holds the existing party BEFORE dialling the new one', async () => {
    // A hold that fails after a stranger is already on the line means that stranger is
    // listening to a client who was never put on hold.
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { phone: '+15145550000' });

    expect(order).toEqual([
      `redirect:${CHILD}`,
      `hold:${ROOT}`,
      'create:new',
    ]);
  });

  it('does not create the new leg when the hold fails', async () => {
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    signalwire.updateParticipant.mockRejectedValueOnce(new Error('nope'));

    await expect(
      service.addCall(ctx(), { phone: '+15145550000' }),
    ).rejects.toThrow();
    expect(signalwire.createCall).not.toHaveBeenCalled();
  });

  it('skips the redirects on a second add — the room already exists', async () => {
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    order.length = 0;

    await service.addCall(c, { phone: '+15145550001' });
    expect(order.filter((o) => o.startsWith('redirect:'))).toEqual([]);
    expect(order).toContain('create:new');
  });

  it('parks everyone already IN THE ROOM when another is added', async () => {
    // A phone holds whoever you were talking to when you dial somebody new.
    const { service, signalwire, order } = setup({
      agentSid: CHILD,
      peerSid: ROOT,
    });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    // The first added party has now answered and is in the room.
    signalwire.listParticipants.mockResolvedValue([
      participant(CHILD),
      participant(ROOT),
      participant('new-leg-1'),
    ]);
    order.length = 0;

    await service.addCall(c, { phone: '+15145550001' });
    expect(order.filter((o) => o.startsWith('hold:'))).toEqual([
      `hold:${ROOT}`,
      'hold:new-leg-1',
    ]);
  });

  /**
   * ⚠️ Otherwise one person not picking up blocks every later add — potentially until
   * their phone gives up and goes to voicemail. They cannot overhear a room they have
   * not joined, so skipping them is correct as well as convenient.
   */
  it('does not wait for, or try to hold, a party who is still ringing', async () => {
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    // new-leg-1 never answers: it is absent from the participant list throughout.
    order.length = 0;

    await service.addCall(c, { phone: '+15145550001' });
    expect(order.filter((o) => o.startsWith('hold:'))).toEqual([`hold:${ROOT}`]);
    expect(order).toContain('create:new');
  });

  it('refuses past the cap', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    for (let i = 0; i < MAX_ADDED_PARTIES; i += 1) {
      await service.addCall(c, { phone: `+1514555000${i}` });
    }
    await expect(service.addCall(c, { phone: '+15145559999' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a call that has not connected yet', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: null as never });
    await expect(service.addCall(ctx(), { phone: '+1514555' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses the company’s own number, which SignalWire would loop', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    await expect(service.addCall(ctx(), { phone: SUPPORT })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reads a contact’s number from the row, never from the request', async () => {
    const { service, signalwire, prisma } = setup({
      agentSid: CHILD,
      peerSid: ROOT,
    });
    await service.addCall(ctx(), { contactId: 42 });

    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 42, companyId: 1 }),
      }),
    );
    expect(signalwire.createCall).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15145558888', from: SUPPORT }),
    );
  });

  it('dials a colleague over SIP, never from the support number', async () => {
    // `Calls?From={support}` is exactly how a company's timeline is built, so a staff
    // leg sent with it would surface in that client's feed.
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { userId: 9 });

    const arg = signalwire.createCall.mock.calls[0][0] as { from: string };
    expect(arg.from.startsWith('sip:')).toBe(true);
    expect(arg.from).not.toContain(SUPPORT);
  });

  /**
   * ⚠️ `ringingByCompany` drives the in-tab Answer banner for ANY idle viewer of the
   * company. Publishing an added leg there would offer a person who was never invited a
   * button that drops them into a live client conference.
   */
  it('rings the colleague WITHOUT publishing to the company', async () => {
    const { service, events } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { userId: 9 });

    expect(events.broadcastIncomingCall).toHaveBeenCalledWith(
      [9],
      expect.anything(),
      { publishToCompany: false },
    );
  });

  it('does not broadcast at all when a plain number is added', async () => {
    const { service, events } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { phone: '+15145550000' });
    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
  });
});

describe('swap', () => {
  const twoParties = async () => {
    const s = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await s.service.addCall(c, { phone: '+15145550000' });
    s.signalwire.listParticipants.mockResolvedValue([
      participant(CHILD),
      participant(ROOT, true),
      participant('new-leg-1', false),
    ]);
    s.order.length = 0;
    return { ...s, c };
  };

  /**
   * ⚠️ HOLD FIRST, THEN UNHOLD. The reverse order puts both parties in one conversation
   * for a moment, which is the exact leak this feature exists to prevent.
   */
  it('holds the talking party before releasing the held one', async () => {
    const { service, c, order } = await twoParties();
    await service.swap(c);
    expect(order).toEqual(['hold:new-leg-1', `unhold:${ROOT}`]);
  });

  it('does not release anybody when the hold fails', async () => {
    const { service, signalwire, c, order } = await twoParties();
    signalwire.updateParticipant.mockRejectedValueOnce(new Error('nope'));

    await expect(service.swap(c)).rejects.toThrow();
    expect(order.some((o) => o.startsWith('unhold:'))).toBe(false);
  });

  it('refuses with anything other than two parties', async () => {
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    signalwire.listParticipants.mockResolvedValue([
      participant(CHILD),
      participant(ROOT),
    ]);
    await expect(service.swap(c)).rejects.toThrow(BadRequestException);
  });
});

describe('merge and drop', () => {
  it('merge releases every party', async () => {
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    order.length = 0;

    await service.merge(c);
    expect(order).toEqual([`unhold:${ROOT}`, 'unhold:new-leg-1']);
  });

  it('hangs the leg up when removing the participant is rejected', async () => {
    // No conference document has an action or a following verb, so "removed from the
    // room" and "hung up" are the same outcome for the person on it.
    const { service, signalwire, order } = setup({
      agentSid: CHILD,
      peerSid: ROOT,
    });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    signalwire.removeParticipant.mockResolvedValueOnce(false);
    order.length = 0;

    await service.dropParty(c, 'p2');
    expect(order).toContain('hangup:new-leg-1');
  });

  /**
   * Otherwise the agent is left talking to somebody who cannot hear them, with the only
   * clue being a badge on a card they may not be looking at.
   */
  it('releases the last remaining party if dropping leaves them held', async () => {
    const { service, signalwire, order } = setup({
      agentSid: CHILD,
      peerSid: ROOT,
    });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    signalwire.listParticipants.mockResolvedValue([
      participant(CHILD),
      participant(ROOT, true),
    ]);
    order.length = 0;

    await service.dropParty(c, 'p2');
    expect(order).toContain(`unhold:${ROOT}`);
  });

  it('rejects a party id that is not on this call', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    await expect(service.dropParty(c, 'p99')).rejects.toThrow(NotFoundException);
  });
});

describe('conferenceStatus never throws', () => {
  it('reports inactive for a call it knows nothing about', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    await expect(service.conferenceStatus('unknown')).resolves.toMatchObject({
      active: false,
    });
  });

  it('reports inactive rather than raising when the provider fails', async () => {
    // A poll that raises turns a transient blip into a card reporting an error over a
    // call that is in fact perfectly fine.
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    signalwire.listConferences.mockRejectedValue(new Error('down'));

    await expect(service.conferenceStatus(ROOT)).resolves.toMatchObject({
      active: false,
    });
  });
});

describe('joinTargetFor is idempotent, NOT one-shot', () => {
  /**
   * ⚠️ THE regression test for the bug that ended three live calls.
   *
   * This used to be a one-shot claim, on the theory that the webhook and an explicit
   * redirect must not both move the root. That theory is unimplementable: a
   * `<Dial action>` webhook has NO no-op response — whatever it returns replaces the
   * leg's document — so the "loser" still emits something, and what it emitted was a
   * hangup for the agent's own leg.
   *
   * Membership is the answer instead, and it must hold for repeated asks: a webhook
   * retry has to get the room again, never a null that falls through to a hangup.
   */
  it('answers for every leg of a live conference, repeatedly', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { phone: '+15145550000' });

    for (const leg of [ROOT, CHILD, 'new-leg-1']) {
      expect(service.joinTargetFor(leg)).not.toBeNull();
      // Twice: a retried webhook must not be told "no conference here".
      expect(service.joinTargetFor(leg)).not.toBeNull();
    }
  });

  it('does not mutate anything it looks at', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { phone: '+15145550000' });

    const before = service.joinTargetFor(ROOT);
    const after = service.joinTargetFor(ROOT);
    expect(after).toBe(before);
    expect(after?.state).not.toBe('ended');
  });

  it('answers null for a leg belonging to no conference', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    expect(service.joinTargetFor('a-stranger')).toBeNull();
  });

  it('answers null once the conference has ended', async () => {
    const { service } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx(), { phone: '+15145550000' });
    service.noteConferenceEvent({
      StatusCallbackEvent: 'conference-end',
      FriendlyName: `cyg-${ROOT}`,
      ConferenceSid: CONF,
    });
    expect(service.joinTargetFor(ROOT)).toBeNull();
  });
});

describe('the formation window — the fix for the second crash', () => {
  /**
   * ⚠️ THE regression test for fault A.
   *
   * The client polls `conferenceStatus` every few seconds. The root is moved into the
   * room by `voice/dial-status`, which takes a second or two, and during that window
   * there is legitimately no assembled room. The previous version DELETED the record on
   * exactly that condition — and once it is gone, dial-status has nothing to join and
   * hangs the call up. Same crash as the original, reached by a different door.
   */
  // Exhausts awaitRoom's full 8s budget on purpose, so it needs more than jest's 5s.
  it('reports an active call and keeps the record while forming', async () => {
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    // No room yet: this is exactly the window a poll must survive.
    signalwire.listConferences.mockResolvedValue([]);
    // Open the room without completing the add (awaitRoom will fail, which is the point).
    await service
      .addCall(ctx(), { phone: '+15145550000' })
      .catch(() => undefined);

    const view = await service.conferenceStatus(ROOT);
    expect(view.active).toBe(true);
    // The load-bearing half: dial-status must still be able to find the room.
    expect(service.joinTargetFor(ROOT)).not.toBeNull();
  }, 15_000);

  // Exhausts awaitRoom's full 8s budget on purpose, so it needs more than jest's 5s.
  it('asks the provider nothing while forming', async () => {
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    signalwire.listConferences.mockResolvedValue([]);
    await service
      .addCall(ctx(), { phone: '+15145550000' })
      .catch(() => undefined);
    signalwire.listConferences.mockClear();

    await service.conferenceStatus(ROOT);
    expect(signalwire.listConferences).not.toHaveBeenCalled();
  }, 15_000);

  // Exhausts awaitRoom's full 8s budget on purpose, so it needs more than jest's 5s.
  it('keeps the record when the room never assembles, so a retry can skip the redirect', async () => {
    const { service, signalwire, order } = setup({
      agentSid: CHILD,
      peerSid: ROOT,
    });
    signalwire.listConferences.mockResolvedValue([]);
    await expect(
      service.addCall(ctx(), { phone: '+15145550000' }),
    ).rejects.toThrow(BadRequestException);

    // The room came up in the meantime.
    signalwire.listConferences.mockResolvedValue([
      { sid: CONF, friendlyName: `cyg-${ROOT}`, status: 'in-progress' },
    ]);
    order.length = 0;
    await service.addCall(ctx(), { phone: '+15145550000' });

    // No second redirect: the legs were already moved the first time.
    expect(order.filter((o) => o.startsWith('redirect:'))).toEqual([]);
  }, 15_000);
});

describe('room selection', () => {
  it('accepts a room that reports init, not just in-progress', async () => {
    const { service } = setup(
      { agentSid: CHILD, peerSid: ROOT },
      { conferences: [{ sid: CONF, friendlyName: `cyg-${ROOT}`, status: 'init' }] },
    );
    await expect(
      service.addCall(ctx(), { phone: '+15145550000' }),
    ).resolves.toBeDefined();
  });

  it('ignores a completed room with the same name', async () => {
    // A name is reused the moment its room empties, so stale rows are normal.
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    signalwire.listConferences.mockResolvedValue([
      { sid: 'old', friendlyName: `cyg-${ROOT}`, status: 'completed' },
      { sid: CONF, friendlyName: `cyg-${ROOT}`, status: 'in-progress' },
    ]);
    await service.addCall(ctx(), { phone: '+15145550000' });
    expect(signalwire.listParticipants).toHaveBeenCalledWith(CONF);
  });

  it('shouts when one name resolves to two live rooms', async () => {
    // The exact failure this fix exists to remove: two rooms, one name, one leg each,
    // neither able to hear the other. Not repairable — LaML addresses a room by NAME —
    // so a loud log is the honest response.
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    signalwire.listConferences.mockResolvedValue([
      { sid: 'a', friendlyName: `cyg-${ROOT}`, status: 'in-progress' },
      { sid: 'b', friendlyName: `cyg-${ROOT}`, status: 'init' },
    ]);
    const err = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await service.addCall(ctx(), { phone: '+15145550000' }).catch(() => undefined);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('SPLIT ROOM'));
  });
});

describe('noteConferenceEvent', () => {
  const open = async () => {
    const s = setup({ agentSid: CHILD, peerSid: ROOT });
    await s.service.addCall(ctx(), { phone: '+15145550000' });
    return s;
  };

  it('ends the conference when its own room ends', async () => {
    const { service } = await open();
    service.noteConferenceEvent({
      StatusCallbackEvent: 'conference-end',
      FriendlyName: `cyg-${ROOT}`,
      ConferenceSid: CONF,
    });
    expect(service.joinTargetFor(ROOT)).toBeNull();
  });

  /**
   * ⚠️ A stale room ending must NOT delete the record. If it did, the root's dial-status
   * would find nothing to join and hang the call up — the original bug, once more.
   */
  it('ignores a conference-end for a room that is not ours', async () => {
    const { service } = await open();
    service.noteConferenceEvent({
      StatusCallbackEvent: 'conference-end',
      FriendlyName: `cyg-${ROOT}`,
      ConferenceSid: 'some-other-room',
    });
    expect(service.joinTargetFor(ROOT)).not.toBeNull();
  });

  it('never throws on a malformed or unknown event', async () => {
    const { service } = await open();
    expect(() => service.noteConferenceEvent({})).not.toThrow();
    expect(() =>
      service.noteConferenceEvent({ FriendlyName: 'not-one-of-ours' }),
    ).not.toThrow();
  });
});

describe('a forked click-to-call: the client holds a DEAD twin root', () => {
  /**
   * The client polls and acts with `dead`; the call really runs on `live`. The room, the
   * dial-status join and the conference callbacks must all use `live`, while the record
   * stays reachable by `dead`.
   */
  const DEAD = 'dead-root';
  const LIVE_ROOT = 'live-root';

  const open = () => {
    const s = setup({ agentSid: LIVE_ROOT, peerSid: CHILD });
    s.callControl.legsFor.mockResolvedValue({
      rootSid: LIVE_ROOT,
      agentSid: LIVE_ROOT,
      peerSid: CHILD,
    });
    return s;
  };
  const deadCtx = () => ctx({ kind: 'outbound', rootSid: DEAD });

  /**
   * ⚠️ THE regression test for `agentIsRoot`. Comparing the agent leg with the client's
   * (dead) sid made it false, turned the live ROOT into the "child", and redirected it — a
   * second mover for the root, which is what dropped live calls the round before.
   */
  it('redirects only the customer, never the live root or the dead twin', async () => {
    const { service, order } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });

    expect(order.filter((o) => o.startsWith('redirect:'))).toEqual([`redirect:${CHILD}`]);
  });

  it('names the room after the LIVE root and records nothing on the child', async () => {
    const { service, signalwire } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });

    const [sid, input] = signalwire.updateCall.mock.calls[0] as [string, { laml: string }];
    expect(sid).toBe(CHILD);
    expect(input.laml).toContain(`cyg-${LIVE_ROOT}`);
    expect(input.laml).not.toContain(`cyg-${DEAD}`);
    expect(input.laml).not.toContain('record=');
  });

  it('answers the poll made with the dead sid', async () => {
    const { service } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });
    await expect(service.conferenceStatus(DEAD)).resolves.toMatchObject({ active: true });
  });

  /**
   * ⚠️ INVERTED. This test used to assert `joinTargetFor(DEAD)` is null — and that encoded
   * the bug. SignalWire posts the forked root's <Dial action> callback under the POST's sid
   * (DEAD) while applying the answer to the live fork, so dial-status MUST recognise DEAD or
   * it answers <Hangup/> and drops the agent.
   */
  it('lets dial-status find the room under the live root AND the POST sid', async () => {
    const { service } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });
    expect(service.joinTargetFor(LIVE_ROOT)).not.toBeNull();
    expect(service.joinTargetFor(DEAD)).toBe(service.joinTargetFor(LIVE_ROOT));
  });

  it('assembles the room when SignalWire reports the agent under the POST sid', async () => {
    // Without normalising, awaitRoom never sees the agent and times out after 8 seconds.
    const { service, signalwire } = open();
    signalwire.listParticipants.mockResolvedValue([
      participant(DEAD),
      participant(CHILD),
    ]);
    await expect(
      service.addCall(deadCtx(), { phone: '+15145550000' }),
    ).resolves.toBeDefined();
  });

  it('goes live from join events that name the agent by the POST sid', async () => {
    const { service, signalwire } = open();
    // Hold the room unassembled so only the events can move it to live.
    signalwire.listConferences.mockResolvedValue([]);
    const pending = service
      .addCall(deadCtx(), { phone: '+15145550000' })
      .catch(() => undefined);
    await new Promise((r) => setImmediate(r));

    for (const callSid of [DEAD, CHILD]) {
      service.noteConferenceEvent({
        StatusCallbackEvent: 'participant-join',
        FriendlyName: `cyg-${LIVE_ROOT}`,
        ConferenceSid: CONF,
        CallSid: callSid,
      });
    }
    expect(service.joinTargetFor(LIVE_ROOT)?.state).toBe('live');
    signalwire.listConferences.mockResolvedValue([
      { sid: CONF, friendlyName: `cyg-${LIVE_ROOT}`, status: 'in-progress' },
    ]);
    await pending;
  }, 15_000);

  it('hands SignalWire no waitUrl or HoldUrl anywhere', async () => {
    // SignalWire fetches those with an empty body, so they could only ever mean silence.
    const { service, signalwire } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });

    const [, childDoc] = signalwire.updateCall.mock.calls[0] as [string, { laml: string }];
    expect(childDoc.laml).not.toContain('waitUrl');
    const [created] = signalwire.createCall.mock.calls[0] as unknown as [{ laml: string }];
    expect(created.laml).not.toContain('waitUrl');
    for (const call of signalwire.updateParticipant.mock.calls) {
      expect(call[2]).not.toHaveProperty('holdUrl');
    }
  });

  it('matches conference callbacks by the live room name', async () => {
    const { service } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });
    expect(service.recordForRoom(`cyg-${LIVE_ROOT}`)).not.toBeNull();
    expect(service.recordForRoom(`cyg-${DEAD}`)).toBeNull();
  });

  /**
   * ⚠️ THE regression test for the deletes. Once `record.rootSid` is the live sid it is no
   * longer the map key, so deleting by it would silently remove nothing — the record would
   * leak and the dead-sid poll would keep reporting a conference that has ended.
   */
  it('removes the entry the client polls when the live room ends', async () => {
    const { service } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });

    service.noteConferenceEvent({
      StatusCallbackEvent: 'conference-end',
      FriendlyName: `cyg-${LIVE_ROOT}`,
      ConferenceSid: CONF,
    });

    expect((service as unknown as { conferences: Map<string, unknown> }).conferences.has(DEAD)).toBe(false);
    await expect(service.conferenceStatus(DEAD)).resolves.toMatchObject({ active: false });
    expect(service.joinTargetFor(LIVE_ROOT)).toBeNull();
  });

  it('finds the existing conference on a second add made with the dead sid', async () => {
    const { service, callControl, order } = open();
    await service.addCall(deadCtx(), { phone: '+15145550000' });
    order.length = 0;

    await service.addCall(deadCtx(), { phone: '+15145550001' });
    expect(callControl.legsFor).toHaveBeenCalledTimes(1);
    expect(order.filter((o) => o.startsWith('redirect:'))).toEqual([]);
  });

  // Exhausts awaitRoom's 8s budget on purpose, so it needs more than jest's 5s.
  it('keeps answering the dead-sid poll while the room is still forming', async () => {
    const { service, signalwire } = open();
    signalwire.listConferences.mockResolvedValue([]);
    await service.addCall(deadCtx(), { phone: '+15145550000' }).catch(() => undefined);

    await expect(service.conferenceStatus(DEAD)).resolves.toMatchObject({ active: true });
    expect(service.joinTargetFor(LIVE_ROOT)).not.toBeNull();
  }, 15_000);
});
