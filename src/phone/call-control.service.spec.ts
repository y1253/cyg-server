import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CallControlService,
  type TransferContext,
} from './call-control.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';
import type { PhoneEventsService } from './phone-events.service';
import type { SwCall } from './signalwire-parse';

function swCall(over: Partial<SwCall> & { sid: string }): SwCall {
  return {
    parentCallSid: null,
    to: '',
    from: '',
    direction: 'inbound',
    status: 'in-progress',
    startedAt: 1_700_000_000_000,
    durationSec: 0,
    ...over,
  };
}

const REQUESTER = { id: 7, name: 'Sarah Cohen' };
const TARGET = { id: 9, name: 'David Levy' };

function setup(calls: Record<string, SwCall>, children: SwCall[]) {
  /** Every provider call, in the order it happened. This is what the order tests read. */
  const order: string[] = [];

  const signalwire = {
    getCall: jest.fn((sid: string) => Promise.resolve(calls[sid] ?? null)),
    listCalls: jest.fn(() => Promise.resolve(children)),
    updateCall: jest.fn((sid: string, input: Record<string, unknown>) => {
      order.push(
        input.status === 'completed' ? `hangup:${sid}` : `redirect:${sid}`,
      );
      return Promise.resolve();
    }),
  };
  const events = { broadcastIncomingCall: jest.fn() };
  const prisma = {
    user: { findFirst: jest.fn(() => Promise.resolve(TARGET)) },
  };

  const service = new CallControlService(
    prisma as unknown as PrismaService,
    signalwire as unknown as SignalWireService,
    events as unknown as PhoneEventsService,
  );
  return { service, signalwire, events, prisma, order };
}

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    SIGNALWIRE_SIP_DOMAIN: 'cygfinance.sip.signalwire.com',
    SIGNALWIRE_SIP_USERNAME: 'cyg',
    SIGNALWIRE_SIP_PASSWORD: 'secret',
    PHONE_WEBHOOK_BASE_URL: 'https://example.test',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

const ctx = (over: Partial<TransferContext> = {}): TransferContext => ({
  rootSid: 'root',
  kind: 'inbound',
  requester: REQUESTER,
  companyId: 42,
  companyName: 'Acme Bookkeeping',
  ...over,
});

describe('resolveTarget', () => {
  it('refuses a transfer to yourself', async () => {
    const { service } = setup({}, []);
    await expect(service.resolveTarget(7, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses someone already on the call', async () => {
    const { service } = setup({}, []);
    await expect(service.resolveTarget(9, 7, [3, 9])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a deleted user', async () => {
    const { service, prisma } = setup({}, []);
    prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.resolveTarget(9, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('blindTransfer', () => {
  it('redirects the CUSTOMER leg on an inbound call, and hangs up the agent after', async () => {
    // ORDER IS THE POINT. Hanging the agent up first tears down the <Dial> while the
    // customer is still executing it, which drops them into voice/dial-status — i.e.
    // into voicemail — before they were ever offered to anybody.
    const { service, order } = setup(
      {
        root: swCall({ sid: 'root', to: '+14382561210', from: '+15145550142' }),
      },
      [swCall({ sid: 'agent-leg', parentCallSid: 'root' })],
    );

    const result = await service.blindTransfer(ctx(), TARGET);

    expect(result.transferredSid).toBe('root');
    expect(order).toEqual(['redirect:root', 'hangup:agent-leg']);
  });

  it('redirects the CHILD on an outbound call — the parent is the agent', async () => {
    // The inversion that has already shipped two bugs. Redirecting the root here would
    // hand the AGENT to the colleague and strand the client on a dead bridge.
    const { service, order } = setup(
      {
        root: swCall({
          sid: 'root',
          to: 'sip:cyg@cygfinance.sip.signalwire.com',
          from: '+14382561210',
          direction: 'outbound-api',
        }),
        'customer-leg': swCall({
          sid: 'customer-leg',
          parentCallSid: 'root',
          to: '+15145550142',
          direction: 'outbound-dial',
        }),
      },
      [
        swCall({
          sid: 'customer-leg',
          parentCallSid: 'root',
          to: '+15145550142',
          direction: 'outbound-dial',
        }),
      ],
    );

    const result = await service.blindTransfer(
      ctx({ kind: 'outbound' }),
      TARGET,
    );

    expect(result.transferredSid).toBe('customer-leg');
    expect(order).toEqual(['redirect:customer-leg', 'hangup:root']);
  });

  it('refuses to transfer a call that has not connected yet', async () => {
    // No child leg means no second party. Falling back to the root would redirect
    // whoever is on it, which on an outbound call is the agent themselves.
    const { service, signalwire } = setup(
      { root: swCall({ sid: 'root', direction: 'outbound-api' }) },
      [],
    );
    await expect(
      service.blindTransfer(ctx({ kind: 'outbound' }), TARGET),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(signalwire.updateCall).not.toHaveBeenCalled();
  });

  it('sends the caller to voicemail if the colleague does not answer', async () => {
    const { service, signalwire } = setup(
      { root: swCall({ sid: 'root', from: '+15145550142' }) },
      [swCall({ sid: 'agent-leg', parentCallSid: 'root' })],
    );
    await service.blindTransfer(ctx(), TARGET);

    const laml = signalwire.updateCall.mock.calls[0][1] as { laml: string };
    // voice/dial-status hangs up on `completed` and offers voicemail on anything else,
    // so reusing it is what makes an unanswered transfer land in voicemail for free.
    expect(laml.laml).toContain(
      'action="https://example.test/api/phone/voice/dial-status"',
    );
    expect(laml.laml).toContain('<Sip>');
  });

  it('carries NO X-Cyg-Call marker, so pairing works when the header is not delivered', async () => {
    // CLAUDE.md records header delivery through a <Sip> URI parameter as UNVERIFIED.
    // A token on the event with no header on the INVITE compares 'tok' !== null and
    // NEVER pairs — the transferred call would ring nobody's screen.
    const { service, signalwire, events } = setup(
      { root: swCall({ sid: 'root', from: '+15145550142' }) },
      [swCall({ sid: 'agent-leg', parentCallSid: 'root' })],
    );
    await service.blindTransfer(ctx(), TARGET);

    const { laml } = signalwire.updateCall.mock.calls[0][1] as { laml: string };
    expect(laml).not.toContain('X-Cyg-Call');
    const event = events.broadcastIncomingCall.mock.calls[0][1] as {
      token?: string;
    };
    expect(event.token).toBeUndefined();
  });

  it('rings only the target, and names who transferred it', async () => {
    const { service, events } = setup(
      { root: swCall({ sid: 'root', from: '+15145550142' }) },
      [swCall({ sid: 'agent-leg', parentCallSid: 'root' })],
    );
    await service.blindTransfer(ctx(), TARGET);

    const [userIds, event] = events.broadcastIncomingCall.mock.calls[0] as [
      number[],
      { from: string; transferFrom?: { id: number; name: string } },
    ];
    expect(userIds).toEqual([TARGET.id]);
    // The card shows the client they will speak to, AND who handed them over.
    expect(event.from).toBe('+15145550142');
    expect(event.transferFrom).toEqual(REQUESTER);
  });

  it('still reports success when the agent leg will not hang up', async () => {
    // The transfer already happened by then; failing here would report a failure for a
    // call that did move, and the leg dies with the bridge anyway.
    const { service, signalwire } = setup(
      { root: swCall({ sid: 'root', from: '+15145550142' }) },
      [swCall({ sid: 'agent-leg', parentCallSid: 'root' })],
    );
    signalwire.updateCall.mockImplementationOnce(() => Promise.resolve());
    signalwire.updateCall.mockImplementationOnce(() =>
      Promise.reject(new Error('gone')),
    );

    await expect(service.blindTransfer(ctx(), TARGET)).resolves.toEqual({
      transferredSid: 'root',
    });
  });

  it('refuses when no SIP endpoint is configured', async () => {
    delete process.env.SIGNALWIRE_SIP_DOMAIN;
    const { service, signalwire } = setup({ root: swCall({ sid: 'root' }) }, [
      swCall({ sid: 'agent-leg', parentCallSid: 'root' }),
    ]);
    await expect(service.blindTransfer(ctx(), TARGET)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(signalwire.updateCall).not.toHaveBeenCalled();
  });
});
