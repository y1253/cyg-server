import {
  classifyLegs,
  conferenceRoomFor,
  pickConnectedChild,
  rootSidFromRoom,
} from './call-legs.util';
import type { SwCall } from './signalwire-parse';

function call(over: Partial<SwCall> & { sid: string }): SwCall {
  return {
    parentCallSid: null,
    to: '',
    from: '',
    direction: 'inbound',
    status: 'completed',
    startedAt: 1_700_000_000_000,
    durationSec: 0,
    ...over,
  };
}

describe('pickConnectedChild', () => {
  it('returns null when there are no children', () => {
    expect(pickConnectedChild([])).toBeNull();
  });

  it('prefers a leg that is still in progress', () => {
    // The case buildPhoneItems never sees and call control always does: on a LIVE call
    // every leg reports durationSec 0, so duration cannot break the tie.
    const picked = pickConnectedChild([
      call({ sid: 'rang-out', status: 'no-answer' }),
      call({ sid: 'live', status: 'in-progress' }),
    ]);
    expect(picked?.sid).toBe('live');
  });

  it('keeps the first in-progress leg when two are live', () => {
    const picked = pickConnectedChild([
      call({ sid: 'first', status: 'in-progress' }),
      call({ sid: 'second', status: 'in-progress' }),
    ]);
    expect(picked?.sid).toBe('first');
  });

  it('falls back to the answered leg on a finished call', () => {
    // This is buildPhoneItems' original rule, and it must be preserved exactly.
    const picked = pickConnectedChild([
      call({ sid: 'unanswered', durationSec: 0 }),
      call({ sid: 'answered', durationSec: 42 }),
    ]);
    expect(picked?.sid).toBe('answered');
  });

  it('keeps the first leg when none connected', () => {
    const picked = pickConnectedChild([
      call({ sid: 'a', durationSec: 0 }),
      call({ sid: 'b', durationSec: 0 }),
    ]);
    expect(picked?.sid).toBe('a');
  });

  it('does not let a later unanswered leg displace an answered one', () => {
    const picked = pickConnectedChild([
      call({ sid: 'answered', durationSec: 12 }),
      call({ sid: 'unanswered', durationSec: 0 }),
    ]);
    expect(picked?.sid).toBe('answered');
  });
});

describe('classifyLegs', () => {
  it('inbound — the ROOT is the customer, the CHILD is the agent', () => {
    const root = call({
      sid: 'root',
      to: '+14382561210',
      from: '+15145550142',
    });
    const legs = classifyLegs(
      root,
      [
        call({
          sid: 'agent-leg',
          parentCallSid: 'root',
          status: 'in-progress',
        }),
      ],
      'inbound',
    );
    expect(legs).toEqual({
      rootSid: 'root',
      agentSid: 'agent-leg',
      peerSid: 'root',
    });
  });

  it('outbound click-to-call — the PARENT is the agent, the CHILD is the customer', () => {
    // Named for the bug. This inversion has shipped twice: once as hasRecording being
    // false on every outbound call, then again as summaryLookupSids. Redirecting the
    // root here would move the AGENT and strand the client.
    const root = call({
      sid: 'root',
      to: 'sip:cyg@cygfinance.sip.signalwire.com',
      from: '+14382561210',
      direction: 'outbound-api',
    });
    const legs = classifyLegs(
      root,
      [
        call({
          sid: 'customer-leg',
          parentCallSid: 'root',
          to: '+15145550142',
          direction: 'outbound-dial',
          status: 'in-progress',
        }),
      ],
      'outbound',
    );
    expect(legs.agentSid).toBe('root');
    expect(legs.peerSid).toBe('customer-leg');
  });

  it('internal — the caller is the root, so who is "the agent" depends on who asks', () => {
    const root = call({ sid: 'root', direction: 'outbound-api' });
    const children = [
      call({ sid: 'callee-leg', parentCallSid: 'root', status: 'in-progress' }),
    ];

    const asCaller = classifyLegs(root, children, 'internal', {
      requesterIsCaller: true,
    });
    expect(asCaller.agentSid).toBe('root');
    expect(asCaller.peerSid).toBe('callee-leg');

    const asCallee = classifyLegs(root, children, 'internal', {
      requesterIsCaller: false,
    });
    expect(asCallee.agentSid).toBe('callee-leg');
    expect(asCallee.peerSid).toBe('root');
  });

  it('returns a null leg rather than guessing when no child exists yet', () => {
    // Still ringing. A caller must read this as "too early", never as "use the root".
    const root = call({ sid: 'root' });
    expect(classifyLegs(root, [], 'inbound').agentSid).toBeNull();
    expect(classifyLegs(root, [], 'outbound').peerSid).toBeNull();
  });

  it('resolves a ring group down to the leg that answered', () => {
    // An unassigned company rings every admin; only one of them picked up.
    const root = call({ sid: 'root' });
    const legs = classifyLegs(
      root,
      [
        call({ sid: 'admin-a', parentCallSid: 'root', status: 'no-answer' }),
        call({ sid: 'admin-b', parentCallSid: 'root', status: 'in-progress' }),
        call({ sid: 'admin-c', parentCallSid: 'root', status: 'canceled' }),
      ],
      'inbound',
    );
    expect(legs.agentSid).toBe('admin-b');
  });
});

describe('conferenceRoomFor', () => {
  it('is deterministic, so a webhook can recompute it from the call sid alone', () => {
    const sid = 'b9c4489d-f26c-4cf0-96cb-23d8c50398d4';
    expect(conferenceRoomFor(sid)).toBe(`cyg-${sid}`);
    expect(conferenceRoomFor(sid)).toBe(conferenceRoomFor(sid));
  });

  it('never collides between two calls', () => {
    // Conference names are account-global; a collision would bridge two clients.
    expect(conferenceRoomFor('one')).not.toBe(conferenceRoomFor('two'));
  });

  it('round-trips through rootSidFromRoom', () => {
    const sid = 'b9c4489d-f26c-4cf0-96cb-23d8c50398d4';
    expect(rootSidFromRoom(conferenceRoomFor(sid))).toBe(sid);
  });

  it('ignores a room that is not ours', () => {
    expect(rootSidFromRoom('someone-elses-room')).toBeNull();
  });
});
