import {
  classifyLegs,
  conferenceRoomFor,
  pickConnectedChild,
  rootSidFromRoom,
  transferStateOf,
  type TransferRecord,
} from './call-legs.util';
import { agentIsOnRoot } from './phone-timeline.util';
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

describe('transferStateOf', () => {
  const AT = 1_700_000_000_000;
  const record = (over: Partial<TransferRecord> = {}): TransferRecord => ({
    peerSid: 'peer',
    previousAgentSid: 'old-agent',
    target: { id: 9, name: 'David Levy' },
    at: AT,
    ...over,
  });

  it('is ringing while the colleague has not answered', () => {
    const peer = call({ sid: 'peer', status: 'in-progress' });
    const fork = call({
      sid: 'fork',
      parentCallSid: 'peer',
      status: 'ringing',
      startedAt: AT + 500,
    });
    expect(transferStateOf(peer, [fork], record())).toBe('ringing');
  });

  it('is answered once the transferee picks up', () => {
    const peer = call({ sid: 'peer', status: 'in-progress' });
    const fork = call({
      sid: 'fork',
      parentCallSid: 'peer',
      status: 'in-progress',
      startedAt: AT + 500,
    });
    expect(transferStateOf(peer, [fork], record())).toBe('answered');
  });

  it('does NOT read the old agent leg as an answer while it is still settling', () => {
    // The agent hangup is best-effort and swallowed, so that leg can still report
    // `in-progress` for a moment. Counting it would close the card — and the take-back
    // with it — the instant the transfer starts.
    const peer = call({ sid: 'peer', status: 'in-progress' });
    const stale = call({
      sid: 'old-agent',
      parentCallSid: 'peer',
      status: 'in-progress',
      startedAt: AT - 60_000,
    });
    expect(transferStateOf(peer, [stale], record())).toBe('ringing');
  });

  it('does NOT read the old agent leg as an answer once it has completed either', () => {
    const peer = call({ sid: 'peer', status: 'in-progress' });
    const stale = call({
      sid: 'old-agent',
      parentCallSid: 'peer',
      status: 'completed',
      durationSec: 42,
      startedAt: AT - 60_000,
    });
    expect(transferStateOf(peer, [stale], record())).toBe('ringing');
  });

  it('reports no-answer while the caller is being sent to voicemail', () => {
    // ⚠️ The peer leg is STILL `in-progress` here — `<Dial action>` fell through to
    // voice/dial-status and the caller is recording a message. A three-state machine
    // would sit on "ringing" forever for exactly the case worth reporting.
    const peer = call({ sid: 'peer', status: 'in-progress' });
    const fork = call({
      sid: 'fork',
      parentCallSid: 'peer',
      status: 'no-answer',
      startedAt: AT + 500,
    });
    expect(transferStateOf(peer, [fork], record())).toBe('no-answer');
  });

  it('is ended when the caller has hung up', () => {
    const peer = call({ sid: 'peer', status: 'completed', durationSec: 90 });
    expect(transferStateOf(peer, [], record())).toBe('ended');
  });

  it('is ended when the peer leg is gone entirely', () => {
    expect(transferStateOf(null, [], record())).toBe('ended');
  });

  it('ignores legs that predate the transfer', () => {
    const peer = call({ sid: 'peer', status: 'in-progress' });
    const older = call({
      sid: 'someone-else',
      parentCallSid: 'peer',
      status: 'in-progress',
      startedAt: AT - 1,
    });
    expect(transferStateOf(peer, [older], record())).toBe('ringing');
  });
});

describe('agentIsOnRoot', () => {
  it('is false on an inbound call — the customer is the root', () => {
    expect(agentIsOnRoot(call({ sid: 'r', to: '+14382561210' }))).toBe(false);
  });

  it('is TRUE on click-to-call — the parent is the agent. This is the inversion', () => {
    expect(
      agentIsOnRoot(
        call({ sid: 'r', to: 'sip:cyg@cygfinance.sip.signalwire.com' }),
      ),
    ).toBe(true);
  });

  it('is false on a leg taken back from a transfer, whose direction says outbound-dial', () => {
    // The leg the agent now holds was dialled outward by the original click-to-call, so
    // `direction` is 'outbound-dial' — but it is now the ROOT of a fresh <Dial><Sip> and
    // the agent is its CHILD. Classifying it from `direction` would redirect the customer
    // while calling them the agent.
    expect(
      agentIsOnRoot(
        call({ sid: 'r', to: '+15145550101', direction: 'outbound-dial' }),
      ),
    ).toBe(false);
  });

  it('sees through a SIP-wrapped E.164, which a startsWith("sip:") test would not', () => {
    expect(
      agentIsOnRoot(
        call({ sid: 'r', to: 'sip:+14382561210@sip.signalwire.com' }),
      ),
    ).toBe(false);
  });
});
