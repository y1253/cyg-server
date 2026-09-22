import {
  BRIDGE_TOLERANCE_MS,
  MAX_RINGING_MS,
  buildPhoneItems,
  carriedTheCall,
  callOutcome,
  counterpartyOfCall,
  hideOwnSmsReplies,
  e164FromSipUri,
  isAudibleRecording,
  isImplicitlyReadCall,
  isPhoneItemId,
  rowItemIdFor,
  isUnreadMissedCall,
  legNumber,
  MIN_RECORDING_SECONDS,
  windowHasLiveLeg,
} from './phone-timeline.util';
import type { SwCall, SwMessage, SwRecording } from './signalwire-parse';
import type { CallItemDto, SmsItemDto } from './phone.types';

const SUPPORT = '+14382561210';
const CUSTOMER = '+19295451253';
const SIP = 'sip:testcyg@cygfinance-2b417c8365ac.sip.signalwire.com';

const T = (min: number) => Date.UTC(2026, 7, 28, 16, min, 0);

function call(over: Partial<SwCall> = {}): SwCall {
  return {
    sid: 'call-1',
    parentCallSid: null,
    to: SUPPORT,
    from: CUSTOMER,
    direction: 'inbound',
    status: 'completed',
    startedAt: T(0),
    durationSec: 30,
    ...over,
  };
}

function sms(over: Partial<SwMessage> = {}): SwMessage {
  return {
    sid: 'msg-1',
    to: SUPPORT,
    from: CUSTOMER,
    direction: 'inbound',
    status: 'received',
    body: 'hello',
    numMedia: 0,
    sentAt: T(5),
    errorCode: null,
    ...over,
  };
}

describe('rowItemIdFor', () => {
  it('names an inbound call after its own leg — the caller IS the root', () => {
    expect(rowItemIdFor(call({ sid: 'p1' }), SUPPORT)).toBe('swcall:p1');
  });

  it('names an outbound CHILD leg after itself', () => {
    const child = call({
      sid: 'ch1',
      parentCallSid: 'p1',
      to: CUSTOMER,
      from: SUPPORT,
      direction: 'outbound-dial',
    });
    expect(rowItemIdFor(child, SUPPORT)).toBe('swcall:ch1');
  });

  /**
   * THE trap this exists for. Click-to-call's root is `To: sip:…`, which the timeline
   * drops — so `swcall:{rootSid}` names a row that does not exist and anything written
   * against it is never read back. Null means "look for the child".
   */
  it('refuses the outbound SIP parent, which is never rendered', () => {
    const root = call({
      sid: 'p1',
      to: SIP,
      from: SUPPORT,
      direction: 'outbound-api',
    });
    expect(rowItemIdFor(root, SUPPORT)).toBeNull();
  });

  /**
   * A leg taken back from a transfer reports `outbound-dial` while being inbound-shaped.
   * Branching on `direction` would send this to the child lookup and find nothing.
   */
  it('names a taken-back leg after itself, despite its outbound direction', () => {
    const takenBack = call({
      sid: 'tb1',
      to: SUPPORT,
      from: CUSTOMER,
      direction: 'outbound-dial',
    });
    expect(rowItemIdFor(takenBack, SUPPORT)).toBe('swcall:tb1');
  });

  it('refuses a leg that has nothing to do with this company', () => {
    expect(
      rowItemIdFor(
        call({ sid: 'x', to: '+15145550000', from: CUSTOMER }),
        SUPPORT,
      ),
    ).toBeNull();
  });
});

describe('isImplicitlyReadCall', () => {
  it('reads every outbound call, whatever became of it', () => {
    for (const outcome of [
      'answered',
      'missed',
      'failed',
      'in-progress',
    ] as const) {
      expect(isImplicitlyReadCall('outbound', outcome)).toBe(true);
    }
  });

  it('reads an inbound call somebody answered', () => {
    expect(isImplicitlyReadCall('inbound', 'answered')).toBe(true);
  });

  it('reads an inbound call that is still up — you are on it', () => {
    expect(isImplicitlyReadCall('inbound', 'in-progress')).toBe(true);
  });

  it('leaves an inbound MISSED call unread — that is the backlog', () => {
    expect(isImplicitlyReadCall('inbound', 'missed')).toBe(false);
  });

  it('leaves an inbound failed call unread', () => {
    expect(isImplicitlyReadCall('inbound', 'failed')).toBe(false);
  });
});

describe('isUnreadMissedCall', () => {
  const item = (over: Partial<CallItemDto> = {}) =>
    ({
      kind: 'call',
      direction: 'inbound',
      outcome: 'missed',
      isRead: false,
      hasVoicemail: false,
      ...over,
    }) as CallItemDto;

  it('counts an inbound, unanswered, unread call', () => {
    expect(isUnreadMissedCall(item())).toBe(true);
  });

  it('counts a voicemail — it is a missed call that left a message', () => {
    expect(isUnreadMissedCall(item({ hasVoicemail: true }))).toBe(true);
  });

  it('stops counting the moment the call is read', () => {
    expect(isUnreadMissedCall(item({ isRead: true }))).toBe(false);
  });

  it('ignores answered, failed and still-ringing calls', () => {
    expect(isUnreadMissedCall(item({ outcome: 'answered' }))).toBe(false);
    expect(isUnreadMissedCall(item({ outcome: 'failed' }))).toBe(false);
    expect(isUnreadMissedCall(item({ outcome: 'in-progress' }))).toBe(false);
  });

  it('ignores an outbound call nobody picked up — that attempt was ours', () => {
    expect(isUnreadMissedCall(item({ direction: 'outbound' }))).toBe(false);
  });

  it('ignores text messages', () => {
    const text = {
      kind: 'sms',
      direction: 'inbound',
      isRead: false,
    } as SmsItemDto;
    expect(isUnreadMissedCall(text)).toBe(false);
  });
});

/**
 * A recording that comfortably clears the audible gate.
 *
 * The 30s default is load-bearing: every pre-existing case here only ever meant "this call
 * has a recording", so they keep asserting exactly what they did before the duration gate
 * existed. A case that means to test the gate overrides `durationSec` explicitly.
 */
function rec(over: Partial<SwRecording> = {}): SwRecording {
  return {
    sid: 'rec-1',
    callSid: 'call-1',
    durationSec: 30,
    status: 'completed',
    createdAt: T(0),
    ...over,
  };
}

const build = (over: Partial<Parameters<typeof buildPhoneItems>[0]> = {}) =>
  buildPhoneItems({
    supportNumber: SUPPORT,
    calls: [],
    sipLegs: [],
    messages: [],
    recordings: [],
    readIds: new Set(),
    completedIds: new Set(),
    ...over,
  });

describe('counterpartyOfCall', () => {
  it('reads the caller off an inbound leg', () => {
    expect(counterpartyOfCall(call(), SUPPORT)).toEqual({
      counterparty: CUSTOMER,
      direction: 'inbound',
    });
  });

  it('reads the callee off an outbound leg', () => {
    expect(
      counterpartyOfCall(call({ to: CUSTOMER, from: SUPPORT }), SUPPORT),
    ).toEqual({ counterparty: CUSTOMER, direction: 'outbound' });
  });

  it('DROPS the SIP parent leg of our own click-to-call', () => {
    // This is the row that would otherwise appear twice for every outbound call.
    // Click-to-call posts To=sip:{shared}@{domain}, From={support}, so the parent
    // leg matches the From={support} query — but its counterparty is a SIP URI, not
    // a number, and it carries no information the child leg does not.
    expect(
      counterpartyOfCall(call({ to: SIP, from: SUPPORT }), SUPPORT),
    ).toBeNull();
  });

  it('drops the SIP child leg of an inbound call', () => {
    // to = a SIP URI, from = sip:+caller@sip.signalwire.com. Neither is our number,
    // so it never reaches the timeline as a row of its own — it is only ever consulted
    // for the call outcome.
    expect(
      counterpartyOfCall(
        call({ to: SIP, from: `sip:${CUSTOMER}@sip.signalwire.com` }),
        SUPPORT,
      ),
    ).toBeNull();
  });

  it('drops a leg belonging to some other number entirely', () => {
    expect(
      counterpartyOfCall(call({ to: '+15551110000' }), SUPPORT),
    ).toBeNull();
  });
});

describe('callOutcome', () => {
  // The single most important rule here: an inbound call nobody answered still
  // reports `completed` on the leg the To={support} query returns, because the
  // <Dial> verb completed. Verified against the live account.
  const unanswered = call({ status: 'completed', durationSec: 24 });

  it('calls an inbound call MISSED when its SIP child rang out', () => {
    const child = call({
      sid: 'child-1',
      parentCallSid: unanswered.sid,
      to: SIP,
      status: 'no-answer',
      durationSec: 24,
    });
    expect(callOutcome(unanswered, 'inbound', child)).toBe('missed');
  });

  it('calls it ANSWERED when the child connected', () => {
    const child = call({
      sid: 'child-1',
      parentCallSid: unanswered.sid,
      to: SIP,
      status: 'completed',
      durationSec: 131,
    });
    expect(callOutcome(unanswered, 'inbound', child)).toBe('answered');
  });

  it('calls it MISSED when there is no child leg at all', () => {
    // The call never reached the <Dial>: an unknown number, or a company with
    // nobody to ring, hears the spoken holding message instead.
    expect(callOutcome(unanswered, 'inbound', undefined)).toBe('missed');
  });

  it('never reports ANSWERED from the parent status alone', () => {
    // Guards the exact regression: reading `status: completed` off the parent and
    // calling it answered marks every missed call as handled.
    expect(callOutcome(unanswered, 'inbound', undefined)).not.toBe('answered');
  });

  it('treats a zero-duration child as missed', () => {
    const child = call({
      parentCallSid: unanswered.sid,
      status: 'completed',
      durationSec: 0,
    });
    expect(callOutcome(unanswered, 'inbound', child)).toBe('missed');
  });

  it('uses the leg itself for outbound, where it IS the customer leg', () => {
    const out = call({ to: CUSTOMER, from: SUPPORT });
    expect(callOutcome(out, 'outbound', undefined)).toBe('answered');
    expect(
      callOutcome(
        { ...out, status: 'no-answer', durationSec: 0 },
        'outbound',
        undefined,
      ),
    ).toBe('missed');
    expect(
      callOutcome({ ...out, status: 'failed' }, 'outbound', undefined),
    ).toBe('failed');
  });

  it('reports a live call as in-progress from either direction', () => {
    // `now` sits just after the call started, i.e. the call really is live.
    const now = T(0) + 5_000;
    for (const status of ['queued', 'initiated', 'ringing', 'in-progress']) {
      expect(callOutcome(call({ status }), 'inbound', undefined, now)).toBe(
        'in-progress',
      );
      expect(callOutcome(call({ status }), 'outbound', undefined, now)).toBe(
        'in-progress',
      );
    }
  });

  it('keeps an ANSWERED call in-progress however long it has been up', () => {
    // A real conversation runs for hours. Ageing one out would tell the agent their own
    // live call had ended.
    const now = T(0) + 4 * 60 * 60 * 1000;
    expect(
      callOutcome(call({ status: 'in-progress' }), 'inbound', undefined, now),
    ).toBe('in-progress');
    expect(
      callOutcome(call({ status: 'in-progress' }), 'outbound', undefined, now),
    ).toBe('in-progress');
  });

  it('calls a leg stuck PRE-ANSWER past any real ring a miss, not in-progress', () => {
    // The zombie: verified live at `ringing` for 8+ hours after its parent completed, and
    // un-endable by Status=completed, Status=canceled, DELETE or a <Hangup/> redirect.
    // Before this it rendered "In progress" forever.
    const now = T(0) + MAX_RINGING_MS + 1;
    for (const status of ['queued', 'initiated', 'ringing']) {
      expect(callOutcome(call({ status }), 'inbound', undefined, now)).toBe(
        'missed',
      );
      expect(callOutcome(call({ status }), 'outbound', undefined, now)).toBe(
        'missed',
      );
    }
  });

  it('does not let an aged-out leg fall through to ANSWERED on its ring time', () => {
    // ⚠️ The regression guard. `ringing` is not in UNCONNECTED, so falling past the live
    // branch would reach `durationSec > 0 ? 'answered' : 'missed'` — and a stuck leg's
    // duration is seconds-since-start (29,891 on the real one), which reads as a long
    // answered call.
    const now = T(0) + MAX_RINGING_MS + 1;
    expect(
      callOutcome(
        call({ status: 'ringing', durationSec: 29_891 }),
        'outbound',
        undefined,
        now,
      ),
    ).toBe('missed');
  });

  it('still ages a leg out exactly at the boundary, not before it', () => {
    const at = call({ status: 'ringing' });
    expect(callOutcome(at, 'outbound', undefined, T(0) + MAX_RINGING_MS)).toBe(
      'in-progress',
    );
    expect(
      callOutcome(at, 'outbound', undefined, T(0) + MAX_RINGING_MS + 1),
    ).toBe('missed');
  });
});

describe('hideOwnSmsReplies — outbound texts are not news', () => {
  const OTHER = '+15145550000';
  const out = (over: Partial<SwMessage> = {}) =>
    sms({ to: CUSTOMER, from: SUPPORT, direction: 'outbound', ...over });

  /** The inbox pipeline: build the rows, then drop your own replies — as `itemsFor` does. */
  const inbox = (over: Parameters<typeof build>[0] = {}) =>
    hideOwnSmsReplies(build(over));

  it('drops a reply you sent to somebody who has written in', () => {
    // Their message owns the row; yours used to add a second, pale one beside it —
    // and, being never `isCompleted`, it also nagged from the UNCOMPLETED badge.
    const items = inbox({
      messages: [sms({ sid: 'in-1' }), out({ sid: 'out-1', sentAt: T(6) })],
    });
    expect(items.map((i) => i.id)).toEqual(['swsms:in-1']);
  });

  it('keeps a conversation YOU started until they answer', () => {
    // Hiding this one would strand the thread: a thread is only ever opened from a row.
    const items = inbox({ messages: [out({ sid: 'out-1' })] });
    expect(items.map((i) => i.id)).toEqual(['swsms:out-1']);
  });

  it('keeps only the newest of several unanswered follow-ups', () => {
    const items = inbox({
      messages: [
        out({ sid: 'out-1', sentAt: T(1) }),
        out({ sid: 'out-3', sentAt: T(3) }),
        out({ sid: 'out-2', sentAt: T(2) }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['swsms:out-3']);
  });

  it('scopes the rule per peer, not across the company', () => {
    // One conversation answered, one not: the unanswered one still shows.
    const items = inbox({
      messages: [
        sms({ sid: 'in-1' }),
        out({ sid: 'out-1', sentAt: T(6) }),
        out({ sid: 'out-2', to: OTHER, sentAt: T(7) }),
      ],
    });
    expect(items.map((i) => i.id).sort()).toEqual([
      'swsms:in-1',
      'swsms:out-2',
    ]);
  });

  it('leaves a surviving outbound row READ — it is not waiting on you', () => {
    const items = inbox({ messages: [out({ sid: 'out-1' })] });
    expect(items[0]).toMatchObject({ direction: 'outbound', isRead: true });
  });

  it('never drops an inbound text', () => {
    const items = inbox({
      messages: [
        sms({ sid: 'in-1', sentAt: T(1) }),
        sms({ sid: 'in-2', sentAt: T(2) }),
      ],
    });
    expect(items.map((i) => i.id).sort()).toEqual(['swsms:in-1', 'swsms:in-2']);
  });

  it('does not touch outbound CALLS — only texts', () => {
    // An outgoing call is a row you want; the rule is about replies in a conversation.
    const items = inbox({
      calls: [
        call({
          sid: 'c-1',
          from: SUPPORT,
          to: CUSTOMER,
          direction: 'outbound-dial',
        }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['swcall:c-1']);
  });
});

describe('buildPhoneItems keeps BOTH directions — the thread depends on it', () => {
  /**
   * ⚠️ The assertion whose absence shipped a bug. The outbound filter briefly lived inside
   * `buildPhoneItems`, which `getSmsThread` also calls — so every message the user had ever
   * sent disappeared from every conversation, and a just-sent reply never appeared at all.
   * The rule belongs to the inbox (`hideOwnSmsReplies`), never to the builder.
   */
  it('returns an outbound text even when the peer has written in', () => {
    const items = build({
      messages: [
        sms({ sid: 'in-1', sentAt: T(1) }),
        sms({
          sid: 'out-1',
          to: CUSTOMER,
          from: SUPPORT,
          direction: 'outbound',
          sentAt: T(2),
        }),
      ],
    });
    expect(items.map((i) => i.id).sort()).toEqual([
      'swsms:in-1',
      'swsms:out-1',
    ]);
  });

  it('returns every outbound text in a long one-sided conversation', () => {
    const out = (sid: string, min: number) =>
      sms({
        sid,
        to: CUSTOMER,
        from: SUPPORT,
        direction: 'outbound',
        sentAt: T(min),
      });
    const items = build({
      messages: [
        sms({ sid: 'in-1', sentAt: T(1) }),
        out('out-1', 2),
        out('out-2', 3),
      ],
    });
    expect(items).toHaveLength(3);
  });
});

describe('buildPhoneItems', () => {
  it('namespaces ids so a call and a message SID can never collide', () => {
    // SignalWire SIDs are uuids with no type prefix, and these ids are written into
    // MessageCompletedState alongside Gmail, Outlook and Google Chat ids.
    const items = build({
      calls: [call({ sid: 'same-uuid' })],
      messages: [sms({ sid: 'same-uuid' })],
    });
    expect(items.map((i) => i.id).sort()).toEqual([
      'swcall:same-uuid',
      'swsms:same-uuid',
    ]);
  });

  it('sorts newest first across both channels', () => {
    const items = build({
      calls: [call({ sid: 'c1', startedAt: T(1) })],
      messages: [
        sms({ sid: 'm1', sentAt: T(9) }),
        sms({ sid: 'm2', sentAt: T(4) }),
      ],
    });
    expect(items.map((i) => i.sid)).toEqual(['m1', 'm2', 'c1']);
  });

  it('de-dupes a leg returned by both the To and From queries', () => {
    // A company texting or calling its own number would otherwise render twice.
    const dup = call({ sid: 'c1' });
    expect(build({ calls: [dup, dup] })).toHaveLength(1);
  });

  it('renders exactly ONE row for an outbound call, not the parent and the child', () => {
    const parent = call({
      sid: 'parent',
      to: SIP,
      from: SUPPORT,
      direction: 'outbound-api',
    });
    const child = call({
      sid: 'child',
      parentCallSid: 'parent',
      to: CUSTOMER,
      from: SUPPORT,
      direction: 'outbound-dial',
    });
    const items = build({ calls: [parent, child] });
    expect(items).toHaveLength(1);
    expect(items[0].sid).toBe('child');
    expect(items[0].counterparty).toBe(CUSTOMER);
  });

  it('marks outbound items read without consulting the read set', () => {
    // You cannot have an unread message you sent yourself.
    const items = build({
      calls: [call({ sid: 'c1', to: CUSTOMER, from: SUPPORT })],
      messages: [
        sms({
          sid: 'm1',
          to: CUSTOMER,
          from: SUPPORT,
          direction: 'outbound-api',
        }),
      ],
    });
    expect(items.every((i) => i.isRead)).toBe(true);
  });

  it('marks an ANSWERED inbound call read, with no row in the read set', () => {
    const items = build({
      calls: [call({ sid: 'p1', status: 'completed', durationSec: 24 })],
      sipLegs: [
        call({
          sid: 'ch1',
          parentCallSid: 'p1',
          to: SIP,
          status: 'completed',
          durationSec: 24,
        }),
      ],
    }) as CallItemDto[];
    expect(items[0].outcome).toBe('answered');
    expect(items[0].isRead).toBe(true);
  });

  it('leaves an unanswered inbound call UNREAD — the badge counts it', () => {
    const items = build({
      calls: [call({ sid: 'p1', status: 'completed', durationSec: 24 })],
      sipLegs: [
        call({
          sid: 'ch1',
          parentCallSid: 'p1',
          to: SIP,
          status: 'no-answer',
          durationSec: 24,
        }),
      ],
    }) as CallItemDto[];
    expect(items[0].outcome).toBe('missed');
    expect(items[0].isRead).toBe(false);
    expect(isUnreadMissedCall(items[0])).toBe(true);
  });

  it('leaves a VOICEMAIL unread — it is a missed call that left a message', () => {
    const items = build({
      calls: [call({ sid: 'p1', status: 'completed', durationSec: 24 })],
      sipLegs: [
        call({
          sid: 'ch1',
          parentCallSid: 'p1',
          to: SIP,
          status: 'no-answer',
          durationSec: 24,
        }),
      ],
      recordings: [rec({ callSid: 'p1', durationSec: 9 })],
    }) as CallItemDto[];
    expect(items[0].hasVoicemail).toBe(true);
    expect(items[0].isRead).toBe(false);
  });

  it('leaves an inbound item unread until its id is in the read set', () => {
    expect(build({ calls: [call({ sid: 'c1' })] })[0].isRead).toBe(false);
    expect(
      build({
        calls: [call({ sid: 'c1' })],
        readIds: new Set(['swcall:c1']),
      })[0].isRead,
    ).toBe(true);
  });

  it('applies completed state by the namespaced id', () => {
    expect(
      build({
        messages: [sms({ sid: 'm1' })],
        completedIds: new Set(['swsms:m1']),
      })[0].isCompleted,
    ).toBe(true);
    // The bare sid must NOT match — that would let a Gmail id collide.
    expect(
      build({
        messages: [sms({ sid: 'm1' })],
        completedIds: new Set(['m1']),
      })[0].isCompleted,
    ).toBe(false);
  });

  it('flags a call that has a recording', () => {
    const items = build({
      calls: [call({ sid: 'c1' })],
      recordings: [rec({ callSid: 'c1' })],
    }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(true);
  });

  it('pairs a child leg to its parent to resolve the outcome', () => {
    const items = build({
      calls: [call({ sid: 'p1', status: 'completed', durationSec: 24 })],
      sipLegs: [
        call({
          sid: 'ch1',
          parentCallSid: 'p1',
          to: SIP,
          status: 'no-answer',
          durationSec: 24,
        }),
      ],
    }) as CallItemDto[];
    expect(items[0].outcome).toBe('missed');
  });

  it('prefers the connected child when a <Dial> rang several targets', () => {
    const items = build({
      calls: [call({ sid: 'p1' })],
      sipLegs: [
        call({
          sid: 'a',
          parentCallSid: 'p1',
          to: SIP,
          status: 'no-answer',
          durationSec: 0,
        }),
        call({
          sid: 'b',
          parentCallSid: 'p1',
          to: SIP,
          status: 'completed',
          durationSec: 40,
        }),
      ],
    }) as CallItemDto[];
    expect(items[0].outcome).toBe('answered');
  });

  it('emits ISO timestamps, whatever RFC-2822 came in', () => {
    expect(build({ calls: [call()] })[0].at).toBe(new Date(T(0)).toISOString());
  });

  it('keeps the SMS body and media count', () => {
    const [item] = build({
      messages: [sms({ body: 'call me back', numMedia: 2 })],
    }) as SmsItemDto[];
    expect(item.body).toBe('call me back');
    expect(item.numMedia).toBe(2);
  });
});

describe('isPhoneItemId', () => {
  it('accepts our own ids', () => {
    expect(isPhoneItemId('swcall:b9c4489d-f26c-4cf0-96cb-23d8c50398d4')).toBe(
      true,
    );
    expect(isPhoneItemId('swsms:1db14388-741d-469c-83e5-77106ef9bc73')).toBe(
      true,
    );
  });

  it('rejects anything else, so the state routes cannot write arbitrary ids', () => {
    // Without this the read/complete endpoints are an arbitrary-messageId writer into
    // tables shared with every mailbox — someone could mark another company's email
    // complete, or fill the table with junk.
    for (const bad of [
      '',
      'swcall:',
      'spaces/AAA/messages/BBB',
      '18f2a3b4c5d6',
      'swcall:../../etc',
      'swmail:x',
      `swcall:${'x'.repeat(200)}`,
      null,
      undefined,
      42,
    ]) {
      expect(isPhoneItemId(bad)).toBe(false);
    }
  });
});

describe('e164FromSipUri / legNumber', () => {
  it('unwraps the number SignalWire puts in a SIP leg', () => {
    // Verified live: the parent leg of our own click-to-call reports its caller id as
    // `sip:+14382561210@sip.signalwire.com`, never the bare number.
    expect(e164FromSipUri('sip:+14382561210@sip.signalwire.com')).toBe(
      '+14382561210',
    );
    expect(e164FromSipUri('sips:+14382561210@example.com')).toBe(
      '+14382561210',
    );
  });

  it('returns null for a SIP user that is not a number', () => {
    expect(
      e164FromSipUri('sip:testcyg@cygfinance-2b417c8365ac.sip.signalwire.com'),
    ).toBeNull();
  });

  it('returns null for junk', () => {
    for (const bad of ['', null, undefined, '+14382561210', 'sip:@x.com']) {
      expect(e164FromSipUri(bad)).toBeNull();
    }
  });

  it('legNumber accepts both the bare and the wrapped form', () => {
    expect(legNumber('+14382561210')).toBe('+14382561210');
    expect(legNumber('sip:+14382561210@sip.signalwire.com')).toBe(
      '+14382561210',
    );
    expect(legNumber('sip:testcyg@x.com')).toBeNull();
    expect(legNumber(null)).toBeNull();
  });
});

describe('hasVoicemail', () => {
  // THE after-hours shape, and the one the whole feature turns on. No <Dial> runs at all,
  // so there is no SIP child leg -- which is exactly what marks the call missed -- and
  // <Record> files the audio against the inbound parent, the row we display.
  it('is true for an unanswered call that has a recording', () => {
    const items = build({
      calls: [call({ sid: 'inbound-1' })],
      sipLegs: [],
      recordings: [rec({ callSid: 'inbound-1' })],
    }) as CallItemDto[];

    expect(items[0].outcome).toBe('missed');
    expect(items[0].hasRecording).toBe(true);
    expect(items[0].hasVoicemail).toBe(true);
  });

  // The distinction the whole derivation rests on: record-from-answer-dual only starts
  // once the dialled party answers, so audio on an ANSWERED call is a conversation.
  // Getting this wrong labels every recorded client call a voicemail.
  it('is false for an answered call that has a recording', () => {
    const items = build({
      calls: [call({ sid: 'inbound-1' })],
      sipLegs: [
        call({
          sid: 'sip-child',
          parentCallSid: 'inbound-1',
          to: SIP,
          direction: 'outbound-dial',
          durationSec: 42,
        }),
      ],
      recordings: [rec({ callSid: 'inbound-1' })],
    }) as CallItemDto[];

    expect(items[0].outcome).toBe('answered');
    expect(items[0].hasVoicemail).toBe(false);
  });

  it('is false for a missed call with no recording', () => {
    const items = build({
      calls: [call({ sid: 'inbound-1' })],
      recordings: [],
    }) as CallItemDto[];

    expect(items[0].outcome).toBe('missed');
    expect(items[0].hasVoicemail).toBe(false);
  });

  // An outbound call we placed cannot have a voicemail left ON it, whatever its status.
  it('is false for an outbound call, even an unanswered recorded one', () => {
    const items = build({
      calls: [
        call({
          sid: 'child-leg',
          parentCallSid: 'sip-parent',
          to: CUSTOMER,
          from: SUPPORT,
          direction: 'outbound-dial',
          status: 'no-answer',
          durationSec: 0,
        }),
      ],
      recordings: [rec({ callSid: 'sip-parent' })],
    }) as CallItemDto[];

    expect(items[0].outcome).toBe('missed');
    // A voicemail is something a CALLER left. The recording lookup also searches the
    // parent SIP leg -- which on click-to-call is the AGENT's own browser leg, and it
    // was answered -- so without the direction check a call we placed could be labelled
    // a message they left.
    expect(items[0].hasVoicemail).toBe(false);
  });
});

describe('recording is found across legs', () => {
  it('finds a recording filed against the row itself (inbound)', () => {
    // Inbound: the <Dial> runs on the leg we display, so the sids match directly.
    const items = build({
      calls: [call({ sid: 'inbound-1' })],
      recordings: [rec({ callSid: 'inbound-1' })],
    }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(true);
  });

  it('finds a recording filed against the PARENT of an outbound row', () => {
    // THE BUG. Click-to-call runs its <Dial> on the parent SIP leg, which the feed drops
    // as a duplicate — so the audio is filed against a sid that is never displayed.
    // Before this, every outbound call showed "No recording for this call" while the
    // recording sat on SignalWire.
    const items = build({
      calls: [
        call({
          sid: 'child-leg',
          parentCallSid: 'sip-parent',
          to: CUSTOMER,
          from: SUPPORT,
          direction: 'outbound-dial',
        }),
      ],
      recordings: [rec({ callSid: 'sip-parent' })],
    }) as CallItemDto[];
    expect(items).toHaveLength(1);
    expect(items[0].hasRecording).toBe(true);
    // And the parent is carried through, so the detail view can fetch the audio.
    expect(items[0].parentCallSid).toBe('sip-parent');
  });

  it('finds a recording filed against a CHILD leg of an inbound row', () => {
    // The third possibility, covered because which leg SignalWire files an inbound
    // recording against has not been observed on a live answered call yet.
    const items = build({
      calls: [call({ sid: 'parent-1' })],
      sipLegs: [
        call({
          sid: 'sip-child',
          parentCallSid: 'parent-1',
          to: SIP,
          durationSec: 40,
        }),
      ],
      recordings: [rec({ callSid: 'sip-child' })],
    }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(true);
  });

  it('does not claim a recording that belongs to an unrelated call', () => {
    const items = build({
      calls: [call({ sid: 'c1', parentCallSid: 'p1' })],
      recordings: [rec({ callSid: 'someone-elses-call' })],
    }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(false);
  });

  it('reports no recording when the account has none', () => {
    const items = build({ calls: [call({ sid: 'c1' })] }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(false);
  });
});

describe('isAudibleRecording', () => {
  it('rejects a recording that will never have audio', () => {
    expect(isAudibleRecording(rec({ status: 'absent', durationSec: 60 }))).toBe(
      false,
    );
    expect(isAudibleRecording(rec({ status: 'failed', durationSec: 60 }))).toBe(
      false,
    );
  });

  // Believed, not measured: an unsettled duration is not final, it settles within seconds,
  // and the 15s poll re-decides. Being pessimistic here hides a real message for as long as
  // SignalWire takes to process it; being optimistic costs one poll of a wrong label.
  it('believes a recording whose duration has not settled', () => {
    for (const status of ['in-progress', 'paused', 'stopped', 'processing']) {
      expect(isAudibleRecording(rec({ status, durationSec: 0 }))).toBe(true);
    }
  });

  it('gates a settled recording on the threshold, inclusively', () => {
    expect(
      isAudibleRecording(rec({ durationSec: MIN_RECORDING_SECONDS - 1 })),
    ).toBe(false);
    expect(
      isAudibleRecording(rec({ durationSec: MIN_RECORDING_SECONDS })),
    ).toBe(true);
  });

  it('honours an explicit threshold, including 0 for the rollback', () => {
    expect(isAudibleRecording(rec({ durationSec: 1 }), 10)).toBe(false);
    expect(isAudibleRecording(rec({ durationSec: 1 }), 0)).toBe(true);
  });
});

/**
 * THE REPORTED BUG. `<Record>` is offered on every unanswered inbound call, and a caller
 * who hangs up at the beep still leaves a Recording resource behind — so membership in the
 * recordings list said "voicemail" for every missed call the company ever took.
 */
describe('the recording duration gate', () => {
  const missed = (
    recordings: SwRecording[],
    over: Partial<Parameters<typeof buildPhoneItems>[0]> = {},
  ) =>
    build({
      calls: [call({ sid: 'inbound-1' })],
      sipLegs: [],
      recordings,
      ...over,
    }) as CallItemDto[];

  it('does not call a hang-up at the beep a voicemail', () => {
    const items = missed([rec({ callSid: 'inbound-1', durationSec: 1 })]);

    expect(items[0].outcome).toBe('missed');
    expect(items[0].hasVoicemail).toBe(false);
    // And no recording either: on a call nobody answered the <Record> attempt is the ONLY
    // recording that can exist, so a sub-threshold one is not "a short recording", it is
    // no message at all. Advertising it would offer a player with nothing behind it.
    expect(items[0].hasRecording).toBe(false);
  });

  it('accepts a message exactly at the threshold', () => {
    const items = missed([
      rec({ callSid: 'inbound-1', durationSec: MIN_RECORDING_SECONDS }),
    ]);
    expect(items[0].hasVoicemail).toBe(true);
  });

  it('lets the longest recording on a call decide', () => {
    const items = missed([
      rec({ sid: 'r1', callSid: 'inbound-1', durationSec: 1 }),
      rec({ sid: 'r2', callSid: 'inbound-1', durationSec: 12 }),
    ]);
    expect(items[0].hasVoicemail).toBe(true);
  });

  it('believes a recording that is still processing', () => {
    const items = missed([
      rec({ callSid: 'inbound-1', durationSec: 0, status: 'processing' }),
    ]);
    expect(items[0].hasVoicemail).toBe(true);
  });

  it('rejects an absent recording however long it claims to be', () => {
    const items = missed([
      rec({ callSid: 'inbound-1', durationSec: 60, status: 'absent' }),
    ]);
    expect(items[0].hasVoicemail).toBe(false);
    expect(items[0].hasRecording).toBe(false);
  });

  // The gate is UNIFORM, not inbound-missed-only, and this pins that. getCallRecordings
  // holds one leg and no SIP child, so it cannot cheaply reproduce "inbound and
  // unanswered" -- a targeted gate would be un-mirrorable there and the row and the detail
  // view would disagree about whether audio exists, which this module has already paid for.
  it('applies to an answered call too', () => {
    const items = build({
      calls: [call({ sid: 'inbound-1' })],
      sipLegs: [
        call({
          sid: 'sip-child',
          parentCallSid: 'inbound-1',
          to: SIP,
          direction: 'outbound-dial',
          durationSec: 42,
        }),
      ],
      recordings: [rec({ callSid: 'inbound-1', durationSec: 1 })],
    }) as CallItemDto[];

    expect(items[0].outcome).toBe('answered');
    expect(items[0].hasRecording).toBe(false);
  });

  it('is fully disabled by minRecordingSec 0 — the rollback', () => {
    const items = missed([rec({ callSid: 'inbound-1', durationSec: 1 })], {
      minRecordingSec: 0,
    });
    expect(items[0].hasVoicemail).toBe(true);
    expect(items[0].hasRecording).toBe(true);
  });
});

describe('contact names', () => {
  const named = new Map([[CUSTOMER, 'Dana Fisher']]);

  it('labels a call and a text whose number is saved', () => {
    const items = build({
      calls: [call()],
      messages: [sms()],
      contactNames: named,
    });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.counterpartyName).toBe('Dana Fisher');
      // The number is still there: it is what "call back" dials and what keys a thread.
      expect(item.counterparty).toBe(CUSTOMER);
    }
  });

  it('gives an unsaved number a null name, never a placeholder string', () => {
    const items = build({
      calls: [call()],
      messages: [sms()],
      contactNames: new Map([['+15559999999', 'Somebody Else']]),
    });
    for (const item of items) expect(item.counterpartyName).toBeNull();
  });

  it('is null when no map is supplied at all', () => {
    // Every pre-existing caller omits it, and none of them may start emitting undefined
    // into a JSON response where the client reads `?? formatE164(...)`.
    const [item] = build({ calls: [call()] });
    expect(item.counterpartyName).toBeNull();
  });

  it('matches an OUTBOUND row too — a name is about the person, not the direction', () => {
    const [item] = build({
      calls: [
        call({ to: CUSTOMER, from: SUPPORT, direction: 'outbound-dial' }),
      ],
      contactNames: named,
    });
    expect(item.counterpartyName).toBe('Dana Fisher');
  });
});

/**
 * The predicate that decides whether a cached window may be held for 45 seconds.
 *
 * `bust()` is edge-triggered — `voice/status` fires it once. If the poll that follows
 * arrives before SignalWire's own row has flipped off `in-progress` (it lags the callback
 * by a beat), the stale answer gets re-pinned for another full TTL with nothing left to
 * dislodge it. That is the reported "it still says In progress a minute after I hung up",
 * and a short TTL for a window holding a live leg is what breaks the loop.
 */
describe('windowHasLiveLeg', () => {
  it('is false for a window of finished calls', () => {
    expect(windowHasLiveLeg([call({ status: 'completed' })], [])).toBe(false);
  });

  it('is true while a call is in progress', () => {
    expect(windowHasLiveLeg([call({ status: 'in-progress' })], [])).toBe(true);
  });

  it('is true while a call is still ringing', () => {
    expect(windowHasLiveLeg([call({ status: 'ringing' })], [])).toBe(true);
  });

  it('looks at the SIP child legs too, not only the parents', () => {
    // An inbound call's parent reports `completed` the moment its <Dial> ends, so the
    // child is the leg that is still live — and it is the one the outcome is read from.
    expect(
      windowHasLiveLeg(
        [call({ status: 'completed' })],
        [call({ sid: 'child', status: 'in-progress' })],
      ),
    ).toBe(true);
  });

  it('is false for an empty window rather than throwing', () => {
    expect(windowHasLiveLeg([], [])).toBe(false);
  });
});

describe('carriedTheCall', () => {
  const parent = call({ sid: 'root', startedAt: T(0), durationSec: 300 });

  it('accepts a leg that ended WITH its parent — they were bridged', () => {
    // A BYE tears both ends of a <Dial> down together, so a genuine pair ends within the
    // provider's own bookkeeping jitter.
    const child = call({
      sid: 'mob',
      parentCallSid: 'root',
      startedAt: T(0) + 8_000,
      durationSec: 292,
    });
    expect(carriedTheCall(child, parent)).toBe(true);
  });

  it('REJECTS a leg that ended while its parent rang on', () => {
    // The carrier voicemail answered, heard the whisper, and never pressed 1. Its leg ends
    // `completed` after ~8 seconds while the parent goes on to record a real voicemail.
    const child = call({
      sid: 'mob',
      parentCallSid: 'root',
      startedAt: T(0) + 5_000,
      durationSec: 8,
    });
    expect(carriedTheCall(child, parent)).toBe(false);
  });

  it('accepts either leg being LIVE, because durationSec is 0 until a call ends', () => {
    // Without this, every mobile-answered call that is still happening would be excluded —
    // exactly the rows LIVE_TTL_MS exists to keep fresh.
    const live = call({
      sid: 'mob',
      parentCallSid: 'root',
      status: 'in-progress',
      durationSec: 0,
    });
    expect(carriedTheCall(live, parent)).toBe(true);
    expect(
      carriedTheCall(
        call({ sid: 'mob', parentCallSid: 'root', durationSec: 8 }),
        call({ sid: 'root', status: 'in-progress', durationSec: 0 }),
      ),
    ).toBe(true);
  });

  it('honours the tolerance boundary', () => {
    const at = (offsetMs: number) =>
      call({
        sid: 'mob',
        parentCallSid: 'root',
        startedAt: T(0),
        durationSec: 300 - offsetMs / 1000,
      });
    expect(carriedTheCall(at(BRIDGE_TOLERANCE_MS), parent)).toBe(true);
    expect(carriedTheCall(at(BRIDGE_TOLERANCE_MS + 1_000), parent)).toBe(false);
  });
});

describe('a call answered on the assigned user MOBILE', () => {
  const root = call({ sid: 'root', startedAt: T(0), durationSec: 300 });
  /** SignalWire cancels the browser branch the moment another target answers. */
  const cancelledSip = call({
    sid: 'sip-leg',
    parentCallSid: 'root',
    to: SIP,
    from: CUSTOMER,
    direction: 'outbound-dial',
    status: 'canceled',
    startedAt: T(0),
    durationSec: 6,
  });
  /** The mobile leg: caller ID passes through, so NEITHER end is the support number. */
  const mobileLeg = call({
    sid: 'mob-leg',
    parentCallSid: 'root',
    to: '+15145550123',
    from: CUSTOMER,
    direction: 'outbound-dial',
    status: 'completed',
    startedAt: T(0) + 8_000,
    durationSec: 292,
  });

  it('is ANSWERED, not missed — the bug this input exists to fix', () => {
    // Without screenedLegs the only child is a `canceled` SIP leg, so callOutcome reports
    // MISSED for a conversation that happened: unread, counted in the dashboard badge, the
    // Missed folder, the tab icon and the bell — and hasVoicemail goes true, presenting
    // the conversation itself as a voicemail.
    const [item] = build({
      calls: [root],
      sipLegs: [cancelledSip],
      screenedLegs: [mobileLeg],
    }) as CallItemDto[];
    expect(item.outcome).toBe('answered');
    expect(item.hasVoicemail).toBe(false);
    expect(item.isRead).toBe(true);
    expect(isUnreadMissedCall(item)).toBe(false);
  });

  it('renders NO row of its own for the mobile leg', () => {
    // Pass-through caller ID means neither end is the support number, so
    // counterpartyOfCall returns null and the existing row filter drops it. That is the
    // whole exclusion — no extra predicate, and no staff mobile in a client-facing feed.
    const items = build({
      calls: [root],
      sipLegs: [cancelledSip],
      screenedLegs: [mobileLeg],
    });
    expect(items).toHaveLength(1);
    expect((items[0] as CallItemDto).counterparty).toBe(CUSTOMER);
  });

  it('would be MISSED without the screened leg — the regression this guards', () => {
    const [item] = build({
      calls: [root],
      sipLegs: [cancelledSip],
    }) as CallItemDto[];
    expect(item.outcome).toBe('missed');
  });
});

describe('a call the CARRIER voicemail answered and never accepted', () => {
  /** The parent rings on, then records a real voicemail: 300s in total. */
  const root = call({ sid: 'root', startedAt: T(0), durationSec: 300 });
  const noAnswerSip = call({
    sid: 'sip-leg',
    parentCallSid: 'root',
    to: SIP,
    from: CUSTOMER,
    direction: 'outbound-dial',
    status: 'no-answer',
    startedAt: T(0),
    durationSec: 30,
  });
  /** Answered by a robot, heard the whisper, pressed nothing, hung up after 8 seconds. */
  const rejectedWhisper = call({
    sid: 'mob-leg',
    parentCallSid: 'root',
    to: '+15145550123',
    from: CUSTOMER,
    direction: 'outbound-dial',
    status: 'completed',
    startedAt: T(0) + 3_000,
    durationSec: 8,
  });
  const voicemail: SwRecording = {
    sid: 'rec-1',
    callSid: 'root',
    conferenceSid: null,
    durationSec: 42,
    status: 'completed',
    createdAt: T(5),
  };

  it('is MISSED, and the voicemail stays visible', () => {
    // ⚠️ The counter-bug. `completed` is not in UNCONNECTED, so pickConnectedChild's tier 1
    // would hand this 8-second leg the win over the no-answer SIP branch, callOutcome would
    // report ANSWERED, and because hasVoicemail requires outcome === 'missed' the message
    // the caller actually left would vanish from the inbox, the badges and the bell.
    const [item] = build({
      calls: [root],
      sipLegs: [noAnswerSip],
      screenedLegs: [rejectedWhisper],
      recordings: [voicemail],
    }) as CallItemDto[];
    expect(item.outcome).toBe('missed');
    expect(item.hasVoicemail).toBe(true);
    expect(isUnreadMissedCall(item)).toBe(true);
  });
});

describe('screened legs that are not ours', () => {
  it('ignores a leg whose parent is not in this window', () => {
    // The query is account-wide: one member of staff assigned to several companies gets
    // their legs back for all of them. Containment is the parent lookup, exactly as it is
    // for sipLegs.
    const [item] = build({
      calls: [call({ sid: 'root', durationSec: 300 })],
      sipLegs: [
        call({
          sid: 'sip-leg',
          parentCallSid: 'root',
          to: SIP,
          status: 'canceled',
          durationSec: 6,
        }),
      ],
      screenedLegs: [
        call({
          sid: 'other-company-leg',
          parentCallSid: 'someone-elses-root',
          to: '+15145550123',
          status: 'completed',
          durationSec: 300,
        }),
      ],
    }) as CallItemDto[];
    expect(item.outcome).toBe('missed');
  });

  it('ignores a parentless leg', () => {
    const [item] = build({
      calls: [call({ sid: 'root', durationSec: 300 })],
      screenedLegs: [
        call({
          sid: 'orphan',
          parentCallSid: null,
          to: '+15145550123',
          durationSec: 300,
        }),
      ],
    }) as CallItemDto[];
    expect(item.outcome).toBe('missed');
  });
});

describe('windowHasLiveLeg with a screened leg', () => {
  it('keeps the window fresh while somebody is talking on their mobile', () => {
    expect(
      windowHasLiveLeg(
        [call({ status: 'completed' })],
        [],
        [call({ sid: 'mob', status: 'in-progress' })],
      ),
    ).toBe(true);
  });

  it('defaults to [], so every existing caller is unaffected', () => {
    expect(windowHasLiveLeg([call({ status: 'completed' })], [])).toBe(false);
  });
});
