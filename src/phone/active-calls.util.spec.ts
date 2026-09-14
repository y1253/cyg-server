import {
  ACTIVE_CALL_TTL_MS,
  CLEAR_GRACE_MS,
  RECONCILE_EVERY_MS,
  busyMessage,
  entryFromLiveRow,
  isExpired,
  needsReconcile,
  shouldClear,
  toView,
  type ActiveCall,
} from './active-calls.util';
import type { SwCall } from './signalwire-parse';

const T = 1_700_000_000_000;
const SUPPORT = '+14382563856';
const CUSTOMER = '+15145550000';

function entry(over: Partial<ActiveCall> = {}): ActiveCall {
  return {
    companyId: 7,
    supportNumber: SUPPORT,
    callSid: 'sid-1',
    direction: 'outbound',
    state: 'active',
    userId: 1,
    userName: 'Sarah',
    peer: CUSTOMER,
    peerName: 'Dana Cohen',
    startedAt: T,
    answeredAt: null,
    verifiedAt: T,
    ...over,
  };
}

function row(over: Partial<SwCall> & { sid: string }): SwCall {
  return {
    parentCallSid: null,
    to: CUSTOMER,
    from: SUPPORT,
    direction: 'outbound-dial',
    status: 'in-progress',
    startedAt: T - 60_000,
    durationSec: 0,
    ...over,
  };
}

describe('shouldClear', () => {
  const old = T + CLEAR_GRACE_MS + 1;

  it('keeps an entry while anything on the number is live', () => {
    // The forked-twin case: the dead twin has ended, the live one has not.
    expect(shouldClear(entry(), 1, old)).toBe(false);
  });

  it('clears an entry once nothing is live', () => {
    expect(shouldClear(entry(), 0, old)).toBe(true);
  });

  it('keeps a young entry even with nothing live, because /Calls can lag', () => {
    expect(shouldClear(entry(), 0, T + CLEAR_GRACE_MS - 1)).toBe(false);
  });

  it('never clears a claim that is still being dialled', () => {
    expect(shouldClear(entry({ state: 'dialing', callSid: null }), 0, T + 60_000)).toBe(false);
  });
});

describe('expiry and reconcile cadence', () => {
  it('expires after the TTL', () => {
    expect(isExpired(entry(), T + ACTIVE_CALL_TTL_MS)).toBe(false);
    expect(isExpired(entry(), T + ACTIVE_CALL_TTL_MS + 1)).toBe(true);
  });

  it('asks SignalWire again once the last check is stale', () => {
    expect(needsReconcile(entry(), T + RECONCILE_EVERY_MS)).toBe(false);
    expect(needsReconcile(entry(), T + RECONCILE_EVERY_MS + 1)).toBe(true);
  });
});

describe('toView', () => {
  it('times an outbound call from the dial', () => {
    expect(toView(entry(), T + 125_000, 1).elapsedSec).toBe(125);
  });

  it('times an answered inbound call from the answer, not the ring', () => {
    const inbound = entry({ direction: 'inbound', answeredAt: T + 20_000 });
    expect(toView(inbound, T + 50_000, 9).elapsedSec).toBe(30);
  });

  it('marks the viewer only when they are the person on the call', () => {
    expect(toView(entry(), T, 1).isViewer).toBe(true);
    expect(toView(entry(), T, 2).isViewer).toBe(false);
    expect(toView(entry({ userId: null }), T, 2).isViewer).toBe(false);
  });

  it('never exposes the support number or user id', () => {
    const view = toView(entry(), T, 1) as unknown as Record<string, unknown>;
    expect(view).not.toHaveProperty('supportNumber');
    expect(view).not.toHaveProperty('userId');
  });
});

describe('entryFromLiveRow', () => {
  it('reads an inbound parent as inbound from the caller', () => {
    const e = entryFromLiveRow(7, SUPPORT, row({ sid: 'p', to: SUPPORT, from: CUSTOMER, direction: 'inbound' }), T);
    expect(e).toMatchObject({ direction: 'inbound', peer: CUSTOMER, userName: null, state: 'active' });
  });

  it('reads an outbound child as outbound to the customer', () => {
    const e = entryFromLiveRow(7, SUPPORT, row({ sid: 'c' }), T);
    expect(e).toMatchObject({ direction: 'outbound', peer: CUSTOMER, startedAt: T - 60_000 });
  });

  it('leaves the peer empty for an outbound root, whose `to` is the SIP address', () => {
    const e = entryFromLiveRow(7, SUPPORT, row({ sid: 'r', to: 'sip:testcyg@x.sip.signalwire.com' }), T);
    expect(e.peer).toBe('');
  });
});

describe('busyMessage', () => {
  it('says who and for how long', () => {
    expect(busyMessage('Acme', entry(), T + 180_000)).toBe(
      "Acme's line is busy: an outbound call is in progress (Sarah), 3 min so far. Try again when it ends.",
    );
  });

  it('names a ringing inbound call and omits an unknown person', () => {
    const ringing = entry({ direction: 'inbound', state: 'ringing', userName: null });
    expect(busyMessage('Acme', ringing, T + 5_000)).toBe(
      "Acme's line is busy: an incoming call is ringing. Try again when it ends.",
    );
  });
});
