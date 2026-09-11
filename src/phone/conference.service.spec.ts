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
  opts: { participants?: SwParticipant[]; conferences?: { sid: string }[] } = {},
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
      Promise.resolve(opts.conferences ?? [{ sid: CONF }]),
    ),
    listParticipants: jest.fn(() =>
      Promise.resolve(opts.participants ?? [participant(legs.agentSid)]),
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
 * ⚠️ THE test for this feature.
 *
 * A <Dial>-created CHILD owns no document of its own, so it dies if its parent's <Dial>
 * is replaced while it is still bridged. The root always owns one. Hence: child first.
 *
 * That is the OPPOSITE of blindTransfer's "peer first" rule, and on an inbound call it
 * is literally the other leg. The two coincide only on outbound — which is exactly how a
 * root-first version passes one test and drops inbound customers in production. So the
 * order is asserted per call kind, with the agent on a different leg each time.
 */
describe('addCall redirects the CHILD before the ROOT, whichever leg that is', () => {
  it('inbound: the customer is the root, so the AGENT leg goes first', async () => {
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(ctx({ kind: 'inbound' }), { phone: '+15145550000' });

    expect(order.slice(0, 2)).toEqual([`redirect:${CHILD}`, `redirect:${ROOT}`]);
  });

  it('outbound: the agent is the root, so the CUSTOMER leg goes first', async () => {
    const { service, order } = setup({ agentSid: ROOT, peerSid: CHILD });
    await service.addCall(ctx({ kind: 'outbound' }), { phone: '+15145550000' });

    expect(order.slice(0, 2)).toEqual([`redirect:${CHILD}`, `redirect:${ROOT}`]);
  });

  it('internal as caller: the callee leg is the child', async () => {
    const { service, order } = setup({ agentSid: ROOT, peerSid: CHILD });
    await service.addCall(
      ctx({ kind: 'internal', requesterIsCaller: true }),
      { userId: 9 },
    );
    expect(order.slice(0, 2)).toEqual([`redirect:${CHILD}`, `redirect:${ROOT}`]);
  });

  it('internal as callee: the caller leg is the root', async () => {
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    await service.addCall(
      ctx({ kind: 'internal', requesterIsCaller: false }),
      { userId: 9 },
    );
    expect(order.slice(0, 2)).toEqual([`redirect:${CHILD}`, `redirect:${ROOT}`]);
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
      `redirect:${ROOT}`,
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

  it('parks everyone already on the call when another is added', async () => {
    // A phone holds whoever you were talking to when you dial somebody new.
    const { service, order } = setup({ agentSid: CHILD, peerSid: ROOT });
    const c = ctx();
    await service.addCall(c, { phone: '+15145550000' });
    order.length = 0;

    await service.addCall(c, { phone: '+15145550001' });
    expect(order.filter((o) => o.startsWith('hold:'))).toEqual([
      `hold:${ROOT}`,
      'hold:new-leg-1',
    ]);
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

describe('awaitingRootJoin is one-shot', () => {
  it('claims the root exactly once, so it cannot be sent to the room twice', async () => {
    const { service, signalwire } = setup({ agentSid: CHILD, peerSid: ROOT });
    // Make the explicit root redirect lose the race by having the webhook claim first.
    signalwire.updateCall.mockImplementationOnce(() => {
      expect(service.awaitingRootJoin(ROOT)).not.toBeNull();
      return Promise.resolve();
    });

    await service.addCall(ctx(), { phone: '+15145550000' });

    // Already claimed by the "webhook" above, so nothing may claim it again.
    expect(service.awaitingRootJoin(ROOT)).toBeNull();
  });
});
