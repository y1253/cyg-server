import { PhoneEventsService, type CallEvent } from './phone-events.service';

const COMPANY = 90;

function inbound(over: Partial<CallEvent> = {}): CallEvent {
  return {
    type: 'incoming-call',
    direction: 'inbound',
    companyId: COMPANY,
    companyName: 'St. Paul',
    from: '+19295451253',
    callSid: 'call-1',
    at: Date.now(),
    ...over,
  };
}

describe('PhoneEventsService — per-company ringing', () => {
  let service: PhoneEventsService;
  beforeEach(() => {
    service = new PhoneEventsService({ publish: jest.fn() } as never);
  });

  it('publishes an inbound call against its company', () => {
    // The point of the index: an admin who is NOT a routed target can still discover
    // the call by asking about the company they are looking at.
    service.broadcastIncomingCall([16], inbound());
    expect(service.getRinging(COMPANY)?.from).toBe('+19295451253');
  });

  it('is readable by someone the call was never routed to', () => {
    // targetUserIds is [16]; nothing about user 7 is recorded in `pending`, yet the
    // company-level answer is the same. That asymmetry IS the feature.
    service.broadcastIncomingCall([16], inbound());
    expect(service.takePending(7)).toBeNull();
    expect(service.getRinging(COMPANY)).not.toBeNull();
  });

  it('does NOT publish an outbound call as ringing', () => {
    // An outbound call auto-answers on the browser that placed it. Publishing it would
    // offer everyone else an Answer button for a call that is already connected.
    service.broadcastOutgoingCall(16, {
      ...inbound(),
      type: 'outgoing-call',
      direction: 'outbound',
      to: '+15551112222',
    });
    expect(service.getRinging(COMPANY)).toBeNull();
  });

  it('returns null for a company with nothing ringing', () => {
    expect(service.getRinging(12345)).toBeNull();
  });

  it('clears when the call ends', () => {
    // Without this the banner keeps offering "Answer" for a dead call until the TTL.
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-1' }));
    service.clearRinging('call-1');
    expect(service.getRinging(COMPANY)).toBeNull();
  });

  it('a status callback for an OLDER call cannot clear a newer one', () => {
    // Keyed on the call sid rather than the company precisely for this: the previous
    // call's "completed" callback can easily land after the next call has started.
    service.broadcastIncomingCall([16], inbound({ callSid: 'old-call' }));
    service.broadcastIncomingCall([16], inbound({ callSid: 'new-call' }));
    service.clearRinging('old-call');
    expect(service.getRinging(COMPANY)?.callSid).toBe('new-call');
  });

  it('expires on its own if no status callback ever arrives', () => {
    // The backstop, and NOT "just past the <Dial timeout='30'>" as it used to be. `at` is
    // stamped in ringAndDial, which runs before the LaML is built, while <Dial timeout>
    // only starts counting once the <Say> greeting has finished playing. At 40s a company
    // with a 15s greeting had its Answer banner blanked while the caller was still
    // ringing. Sized for greeting + ring + slack instead.
    service.broadcastIncomingCall([16], inbound({ at: Date.now() - 91_000 }));
    expect(service.getRinging(COMPANY)).toBeNull();
  });

  it('keeps a call that is still within the ring window', () => {
    service.broadcastIncomingCall([16], inbound({ at: Date.now() - 10_000 }));
    expect(service.getRinging(COMPANY)).not.toBeNull();
  });

  it('still records pending for the routed targets', () => {
    // The existing popup path must be untouched by any of this.
    service.broadcastIncomingCall([16, 7], inbound());
    expect(service.takePending(16)?.companyName).toBe('St. Paul');
    expect(service.takePending(7)?.companyName).toBe('St. Paul');
  });
});

describe('PhoneEventsService — call waiting: two calls at once', () => {
  let service: PhoneEventsService;
  beforeEach(() => {
    service = new PhoneEventsService({ publish: jest.fn() } as never);
  });

  it('KEEPS both calls for one agent instead of overwriting', () => {
    // THE assertion the whole feature rests on. `pending` used to be one slot per user, so
    // a second ring erased the first — and the browser, holding two INVITEs, could only
    // ever learn about one of them.
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-1' }));
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-2' }));

    expect(service.takeAllPending(16).map((e) => e.callSid)).toEqual([
      'call-2',
      'call-1',
    ]);
    // The singular route still answers, newest first, for a cached client build.
    expect(service.takePending(16)?.callSid).toBe('call-2');
  });

  it('keeps both rings for one company, and clearing one leaves the other', () => {
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-1' }));
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-2' }));

    service.clearRinging('call-2');

    // The older call is still ringing — `clearRinging` used to `break` on the first match
    // and would have stranded it under the newer one.
    expect(service.getRinging(COMPANY)?.callSid).toBe('call-1');
    expect(service.takeAllPending(16).map((e) => e.callSid)).toEqual([
      'call-1',
    ]);
  });

  it('a re-broadcast of the same sid replaces rather than duplicates', () => {
    // A retried webhook must not make one call look like two.
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-1' }));
    service.broadcastIncomingCall([16], inbound({ callSid: 'call-1' }));
    expect(service.takeAllPending(16)).toHaveLength(1);
  });

  it('clearPendingFor with a sid spares the other calls of that agent', () => {
    // A blind transfer hands over ONE call. Dropping every entry for the user — which is
    // what the sid-less form does — would blind them to the calls they kept.
    service.broadcastIncomingCall([7], inbound({ callSid: 'call-1' }));
    service.broadcastIncomingCall([7], inbound({ callSid: 'call-2' }));

    service.clearPendingFor(7, 'call-1');

    expect(service.takeAllPending(7).map((e) => e.callSid)).toEqual(['call-2']);
  });

  it('drops the expired call and keeps the live one', () => {
    service.broadcastIncomingCall(
      [16],
      inbound({ callSid: 'old', at: Date.now() - 121_000 }),
    );
    service.broadcastIncomingCall([16], inbound({ callSid: 'new' }));
    expect(service.takeAllPending(16).map((e) => e.callSid)).toEqual(['new']);
  });
});

describe('PhoneEventsService — forgetting a call that has moved on', () => {
  let service: PhoneEventsService;
  beforeEach(() => {
    service = new PhoneEventsService({ publish: jest.fn() } as never);
  });

  it('clearPendingFor drops only that user', () => {
    // On an INBOUND transfer the transferrer's stale entry and the transferee's new one
    // carry the SAME callSid, which is exactly why this is keyed by user and not by sid.
    service.broadcastIncomingCall([7, 9], inbound());
    service.clearPendingFor(7);
    expect(service.takePending(7)).toBeNull();
    expect(service.takePending(9)).not.toBeNull();
  });

  it('clearRinging also sweeps pending for that call', () => {
    // `takePending` is a peek, so without this a finished call stays answerable for a
    // full minute and any idle colleague can pair a LATER unmarked INVITE with it.
    service.broadcastIncomingCall([7, 9], inbound());
    service.clearRinging('call-1');
    expect(service.takePending(7)).toBeNull();
    expect(service.takePending(9)).toBeNull();
  });

  it('clearRinging leaves a DIFFERENT call alone', () => {
    service.broadcastIncomingCall([7], inbound());
    service.clearRinging('some-other-call');
    expect(service.takePending(7)).not.toBeNull();
    expect(service.getRinging(COMPANY)).not.toBeNull();
  });

  it('hides a transferred call from the person who transferred it', () => {
    // Their browser is holding a fork of the transfer <Dial>, so without this the in-tab
    // banner offers them back the call they deliberately handed over.
    service.broadcastIncomingCall(
      [9],
      inbound({ transferFrom: { id: 7, name: 'Sarah Cohen' } }),
    );
    expect(service.getRinging(COMPANY, 7)).toBeNull();
    expect(service.getRinging(COMPANY, 9)).not.toBeNull();
    expect(service.getRinging(COMPANY)).not.toBeNull();
  });
});

describe('PhoneEventsService — the two presence windows', () => {
  let service: PhoneEventsService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new PhoneEventsService({ publish: jest.fn() } as never);
  });
  afterEach(() => jest.useRealTimers());

  it('keeps the picker at 45s while the ring gate reaches further back', () => {
    // Two questions, two windows. 45s answers "is Dana at her desk this second"; the ring
    // gate asks "is Dana on duty", and a backgrounded tab stops beating long before she
    // goes home.
    service.noteHeartbeat(4, false);
    jest.advanceTimersByTime(60_000);

    expect(service.presenceFor([4]).userIds).toEqual([]);
    expect(service.presentForRinging([4])).toEqual([4]);
  });

  it('forgets a user once even the longer window has passed', () => {
    service.noteHeartbeat(4, false);
    jest.advanceTimersByTime(6 * 60_000);

    expect(service.presenceFor([4]).userIds).toEqual([]);
    expect(service.presentForRinging([4])).toEqual([]);
  });

  it('a picker read must not destroy the entry the ring gate needs', () => {
    // ⚠️ The trap this ordering exists for. `liveHeartbeats` prunes as it reads, so
    // pruning at 45s would delete the row during the picker's own call and the ring gate
    // would then answer "signed out" for everybody whose tab is merely backgrounded —
    // exactly the failure the longer window was added to prevent.
    service.noteHeartbeat(4, false);
    jest.advanceTimersByTime(60_000);

    service.presenceFor([4]);
    expect(service.presentForRinging([4])).toEqual([4]);
  });

  it('answers for a fresh heartbeat on both', () => {
    service.noteHeartbeat(4, false);
    expect(service.presenceFor([4]).userIds).toEqual([4]);
    expect(service.presentForRinging([4])).toEqual([4]);
  });

  it('never invents a user who has not beaten at all', () => {
    expect(service.presentForRinging([9])).toEqual([]);
  });
});

describe('PhoneEventsService — the presence change-gate', () => {
  let realtime: { publish: jest.Mock };
  let service: PhoneEventsService;

  beforeEach(() => {
    realtime = { publish: jest.fn() };
    service = new PhoneEventsService(realtime as never);
  });

  it('publishes when somebody first appears', () => {
    service.noteHeartbeat(4, false);
    expect(realtime.publish).toHaveBeenCalledWith('presence');
  });

  it('publishes NOTHING for a routine repeat beat', () => {
    // ⚠️ The whole point. Every browser beats every 20s whether or not anything has
    // changed, so publishing unconditionally would wake every parked long-poll in the
    // firm three times a minute per user, to say precisely nothing.
    service.noteHeartbeat(4, false);
    realtime.publish.mockClear();

    service.noteHeartbeat(4, false);
    service.noteHeartbeat(4, false);

    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it('publishes on a busy flip, in both directions', () => {
    service.noteHeartbeat(4, false);
    realtime.publish.mockClear();

    service.noteHeartbeat(4, true);
    expect(realtime.publish).toHaveBeenCalledTimes(1);

    service.noteHeartbeat(4, false);
    expect(realtime.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes again when somebody returns after going stale', () => {
    // A beat older than HEARTBEAT_TTL_MS means they had dropped off every colleague's
    // list, so coming back IS a change even though the busy flag never moved.
    const realNow = Date.now;
    Date.now = () => 1_000_000;
    service.noteHeartbeat(4, false);
    realtime.publish.mockClear();

    Date.now = () => 1_000_000 + 46_000;
    service.noteHeartbeat(4, false);
    expect(realtime.publish).toHaveBeenCalledWith('presence');

    Date.now = realNow;
  });

  it('keeps reporting presence correctly either way', () => {
    // The gate decides who is TOLD, never what is true.
    service.noteHeartbeat(4, true);
    service.noteHeartbeat(4, true);
    expect(service.presenceFor([4, 5])).toEqual({
      userIds: [4],
      busyUserIds: [4],
    });
  });
});
