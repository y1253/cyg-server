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
    // The backstop. 40s is just past the <Dial timeout="30"> the webhook sends.
    service.broadcastIncomingCall([16], inbound({ at: Date.now() - 41_000 }));
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
