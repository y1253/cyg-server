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
    service = new PhoneEventsService();
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
    service = new PhoneEventsService();
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
    service = new PhoneEventsService();
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

describe('PhoneEventsService — screened mobile legs', () => {
  let service: PhoneEventsService;
  const MOBILE = '+15145550123';

  function expectation(over: Record<string, unknown> = {}) {
    return {
      rootSid: 'root-1',
      mobile: MOBILE,
      userId: 16,
      companyId: COMPANY,
      companyName: 'St. Paul',
      from: '+19295451253',
      fromName: null,
      ttlMs: 90_000,
      ...over,
    };
  }

  beforeEach(() => {
    service = new PhoneEventsService();
  });

  it('finds the call exactly, by ParentCallSid', () => {
    service.expectScreen(expectation());
    expect(service.findScreen({ parentCallSid: 'root-1' })?.companyName).toBe(
      'St. Paul',
    );
  });

  it('falls back to the mobile when ParentCallSid is not posted', () => {
    // Whether SignalWire sends ParentCallSid on a <Number url> request is Twilio-documented
    // and unverified against this account. This fallback is the entire reason that is
    // survivable rather than a blocker.
    service.expectScreen(expectation());
    expect(service.findScreen({ to: MOBILE })?.rootSid).toBe('root-1');
  });

  it('REFUSES to guess when one mobile has two live calls', () => {
    // One member of staff is assigned to many companies, and two of them can ring the same
    // phone at once. Naming the wrong client out loud is worse than naming none — and the
    // degraded whisper still accepts the call, so nothing is lost but the name.
    service.expectScreen(expectation({ rootSid: 'root-1', companyName: 'A' }));
    service.expectScreen(expectation({ rootSid: 'root-2', companyName: 'B' }));
    expect(service.findScreen({ to: MOBILE })).toBeNull();
    // ...but an exact match still resolves, which is why the ambiguity costs nothing when
    // ParentCallSid does arrive.
    expect(service.findScreen({ parentCallSid: 'root-2' })?.companyName).toBe(
      'B',
    );
  });

  it('PEEKS rather than consuming — it is read twice per call', () => {
    // Unlike takeVoiceCodeExpectation: once to build the whisper, once for the keypress.
    // Consuming on the first read would lose the company on the second.
    service.expectScreen(expectation());
    expect(service.findScreen({ parentCallSid: 'root-1' })).not.toBeNull();
    expect(service.findScreen({ parentCallSid: 'root-1' })).not.toBeNull();
  });

  it('clears from BOTH indexes, so a later call cannot match a dead one', () => {
    service.expectScreen(expectation());
    const found = service.findScreen({ parentCallSid: 'root-1' });
    expect(found).not.toBeNull();
    service.clearScreen(found!);
    expect(service.findScreen({ parentCallSid: 'root-1' })).toBeNull();
    expect(service.findScreen({ to: MOBILE })).toBeNull();
  });

  it('expires on its own, with no sweep', () => {
    jest.useFakeTimers();
    try {
      service.expectScreen(expectation({ ttlMs: 1_000 }));
      jest.advanceTimersByTime(1_500);
      expect(service.findScreen({ parentCallSid: 'root-1' })).toBeNull();
      expect(service.findScreen({ to: MOBILE })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the OTHER registries alone', () => {
    // It lives beside ringingByCompany and voiceCodeExpectations; it must not disturb them.
    service.broadcastIncomingCall([16], inbound());
    service.expectScreen(expectation());
    expect(service.getRinging(COMPANY)?.from).toBe('+19295451253');
    expect(service.takeVoiceCodeExpectation(MOBILE)).toBeNull();
  });
});
