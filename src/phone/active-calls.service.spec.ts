import { ConflictException } from '@nestjs/common';
import { ActiveCallsService } from './active-calls.service';
import type { SwCall } from './signalwire-parse';

const T = 1_700_000_000_000;
const SUPPORT = '+14382563856';
const CUSTOMER = '+15145550000';
const SIP = 'sip:testcyg@cygfinance.sip.signalwire.com';

function row(over: Partial<SwCall> & { sid: string }): SwCall {
  return {
    parentCallSid: null,
    to: SIP,
    from: SUPPORT,
    direction: 'outbound-api',
    status: 'in-progress',
    startedAt: T,
    durationSec: 0,
    ...over,
  };
}

const CLAIM = {
  companyId: 7,
  companyName: 'Acme',
  supportNumber: SUPPORT,
  userId: 1,
  peer: CUSTOMER,
};

let now = T;

function setup() {
  const signalwire = { listCalls: jest.fn().mockResolvedValue([]) };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ name: 'Sarah' }) },
  };
  const contacts = { nameForNumber: jest.fn().mockResolvedValue('Dana Cohen') };
  const service = new ActiveCallsService(
    signalwire as never,
    prisma as never,
    contacts as never,
  );
  return { service, signalwire, prisma, contacts };
}

beforeEach(() => {
  now = T;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('claim', () => {
  it('reserves the line and names who is on it once committed', async () => {
    const { service } = setup();
    const hold = await service.claim(CLAIM);
    hold.commit('sid-1');

    expect(service.get(7)).toMatchObject({
      callSid: 'sid-1',
      direction: 'outbound',
      state: 'active',
      userName: 'Sarah',
      peerName: 'Dana Cohen',
    });
  });

  it('refuses a second click that lands before the first has awaited anything', async () => {
    const { service, signalwire } = setup();
    const first = service.claim(CLAIM);
    const second = service.claim({ ...CLAIM, userId: 2 });

    await expect(second).rejects.toBeInstanceOf(ConflictException);
    await expect(first).resolves.toBeDefined();
    // Only the first claim reached SignalWire (one request per direction).
    expect(signalwire.listCalls).toHaveBeenCalledTimes(2);
  });

  it('frees the line when the dial fails', async () => {
    const { service } = setup();
    const hold = await service.claim(CLAIM);
    hold.release();

    expect(service.get(7)).toBeNull();
    await expect(service.claim(CLAIM)).resolves.toBeDefined();
  });

  it('refuses when SignalWire lists a live call we have no entry for, and remembers it', async () => {
    // After a restart the map is empty, but the call is still up.
    const { service, signalwire } = setup();
    signalwire.listCalls.mockResolvedValue([
      row({ sid: 'inbound-parent', to: SUPPORT, from: CUSTOMER, direction: 'inbound' }),
    ]);

    await expect(service.claim(CLAIM)).rejects.toThrow("Acme's line is busy");
    expect(service.get(7)).toMatchObject({
      callSid: 'inbound-parent',
      direction: 'inbound',
      userName: null,
    });
  });

  it('ignores finished calls in the SignalWire list', async () => {
    const { service, signalwire } = setup();
    signalwire.listCalls.mockResolvedValue([row({ sid: 'old', status: 'completed' })]);
    await expect(service.claim(CLAIM)).resolves.toBeDefined();
  });

  it('does not refuse a dial because SignalWire is unreachable', async () => {
    const { service, signalwire } = setup();
    signalwire.listCalls.mockRejectedValue(new Error('timeout'));
    await expect(service.claim(CLAIM)).resolves.toBeDefined();
  });
});

describe('inbound calls', () => {
  const RING = {
    companyId: 7,
    supportNumber: SUPPORT,
    callSid: 'in-1',
    from: CUSTOMER,
    fromName: 'Dana Cohen',
  };

  it('marks the line busy while ringing, and names who answered', async () => {
    const { service } = setup();
    service.noteInboundRinging(RING);
    expect(service.get(7)).toMatchObject({ state: 'ringing', userName: null });

    now = T + 8_000;
    await expect(service.markAnswered(7, 'in-1', 1)).resolves.toBe(true);
    expect(service.get(7)).toMatchObject({
      state: 'active',
      answeredAt: T + 8_000,
      userName: 'Sarah',
    });
  });

  it('never creates an entry from an answered report', async () => {
    const { service } = setup();
    await expect(service.markAnswered(7, 'in-1', 1)).resolves.toBe(false);
    expect(service.get(7)).toBeNull();
  });

  it('ignores an answered report for a different call', async () => {
    const { service } = setup();
    service.noteInboundRinging(RING);
    await expect(service.markAnswered(7, 'someone-else', 1)).resolves.toBe(false);
    expect(service.get(7)?.state).toBe('ringing');
  });

  it('does not let a ring overwrite a live outbound call', async () => {
    const { service } = setup();
    (await service.claim(CLAIM)).commit('out-1');
    service.noteInboundRinging(RING);
    expect(service.get(7)).toMatchObject({ callSid: 'out-1', direction: 'outbound' });
  });

  it('a SECOND inbound ring does not erase the call already in progress', async () => {
    // Call waiting. The line now legitimately carries two calls, and the indicator must
    // keep naming the CONVERSATION — it used to flip to the new caller mid-sentence.
    const { service } = setup();
    service.noteInboundRinging(RING);
    await service.markAnswered(7, 'in-1', 1);

    service.noteInboundRinging({ ...RING, callSid: 'in-2', from: '+15145559999' });

    expect(service.get(7)).toMatchObject({
      callSid: 'in-1',
      state: 'active',
      userId: 1,
    });
  });

  it('answers the SECOND call by sid, not by whichever entry is current', async () => {
    const { service } = setup();
    service.noteInboundRinging(RING);
    service.noteInboundRinging({ ...RING, callSid: 'in-2' });

    await expect(service.markAnswered(7, 'in-2', 1)).resolves.toBe(true);
  });
});

describe('onTerminalStatus', () => {
  it('keeps the line busy when the DEAD twin of a forked call ends, and frees it when the live one does', async () => {
    const { service, signalwire } = setup();
    (await service.claim(CLAIM)).commit('dead-twin');

    // Seconds later the dead twin reports no-answer, while the live twin is up.
    now = T + 20_000;
    signalwire.listCalls.mockResolvedValue([row({ sid: 'live-twin' })]);
    await service.onTerminalStatus('dead-twin', SIP, SUPPORT);
    expect(service.get(7)).not.toBeNull();

    // The live twin's own callback carries a sid we never learned; the number matches.
    now = T + 200_000;
    signalwire.listCalls.mockResolvedValue([]);
    await service.onTerminalStatus('live-twin', SIP, SUPPORT);
    expect(service.get(7)).toBeNull();
  });

  it('matches a SIP-wrapped support number', async () => {
    const { service } = setup();
    (await service.claim(CLAIM)).commit('out-1');

    now = T + 60_000;
    await service.onTerminalStatus('unknown', SIP, `sip:${SUPPORT}@sip.signalwire.com`);
    expect(service.get(7)).toBeNull();
  });

  it('keeps a young entry even when SignalWire already lists nothing', async () => {
    const { service } = setup();
    (await service.claim(CLAIM)).commit('out-1');

    now = T + 2_000;
    await service.onTerminalStatus('out-1', SIP, SUPPORT);
    expect(service.get(7)).not.toBeNull();
  });

  it('does nothing for a call on a number with no entry', async () => {
    const { service, signalwire } = setup();
    await service.onTerminalStatus('x', '+15145559999', '+15145558888');
    expect(signalwire.listCalls).not.toHaveBeenCalled();
  });
});

describe('get', () => {
  it('re-checks a stale entry in the background and clears it when nothing is live', async () => {
    const { service, signalwire } = setup();
    (await service.claim(CLAIM)).commit('out-1');
    signalwire.listCalls.mockClear();

    now = T + 45_000;
    expect(service.get(7)).not.toBeNull();
    expect(signalwire.listCalls).toHaveBeenCalledTimes(2);

    await new Promise((resolve) => setImmediate(resolve));
    expect(service.get(7)).toBeNull();
  });
});
