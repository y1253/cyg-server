import {
  buildPhoneItems,
  callOutcome,
  counterpartyOfCall,
  e164FromSipUri,
  isPhoneItemId,
  legNumber,
} from './phone-timeline.util';
import type { SwCall, SwMessage } from './signalwire-parse';
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

const build = (over: Partial<Parameters<typeof buildPhoneItems>[0]> = {}) =>
  buildPhoneItems({
    supportNumber: SUPPORT,
    calls: [],
    sipLegs: [],
    messages: [],
    recordedCallSids: new Set(),
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
    expect(counterpartyOfCall(call({ to: SIP, from: SUPPORT }), SUPPORT)).toBeNull();
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
      callOutcome({ ...out, status: 'no-answer', durationSec: 0 }, 'outbound', undefined),
    ).toBe('missed');
    expect(
      callOutcome({ ...out, status: 'failed' }, 'outbound', undefined),
    ).toBe('failed');
  });

  it('reports a live call as in-progress from either direction', () => {
    for (const status of ['queued', 'initiated', 'ringing', 'in-progress']) {
      expect(callOutcome(call({ status }), 'inbound', undefined)).toBe(
        'in-progress',
      );
    }
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
        sms({ sid: 'm1', to: CUSTOMER, from: SUPPORT, direction: 'outbound-api' }),
      ],
    });
    expect(items.every((i) => i.isRead)).toBe(true);
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
      recordedCallSids: new Set(['c1']),
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
        call({ sid: 'a', parentCallSid: 'p1', to: SIP, status: 'no-answer', durationSec: 0 }),
        call({ sid: 'b', parentCallSid: 'p1', to: SIP, status: 'completed', durationSec: 40 }),
      ],
    }) as CallItemDto[];
    expect(items[0].outcome).toBe('answered');
  });

  it('emits ISO timestamps, whatever RFC-2822 came in', () => {
    expect(build({ calls: [call()] })[0].at).toBe(
      new Date(T(0)).toISOString(),
    );
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
    expect(isPhoneItemId('swcall:b9c4489d-f26c-4cf0-96cb-23d8c50398d4')).toBe(true);
    expect(isPhoneItemId('swsms:1db14388-741d-469c-83e5-77106ef9bc73')).toBe(true);
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
    expect(e164FromSipUri('sips:+14382561210@example.com')).toBe('+14382561210');
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
    expect(legNumber('sip:+14382561210@sip.signalwire.com')).toBe('+14382561210');
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
      recordedCallSids: new Set(['inbound-1']),
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
      recordedCallSids: new Set(['inbound-1']),
    }) as CallItemDto[];

    expect(items[0].outcome).toBe('answered');
    expect(items[0].hasVoicemail).toBe(false);
  });

  it('is false for a missed call with no recording', () => {
    const items = build({
      calls: [call({ sid: 'inbound-1' })],
      recordedCallSids: new Set(),
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
      recordedCallSids: new Set(['sip-parent']),
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
      recordedCallSids: new Set(['inbound-1']),
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
      recordedCallSids: new Set(['sip-parent']),
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
        call({ sid: 'sip-child', parentCallSid: 'parent-1', to: SIP, durationSec: 40 }),
      ],
      recordedCallSids: new Set(['sip-child']),
    }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(true);
  });

  it('does not claim a recording that belongs to an unrelated call', () => {
    const items = build({
      calls: [call({ sid: 'c1', parentCallSid: 'p1' })],
      recordedCallSids: new Set(['someone-elses-call']),
    }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(false);
  });

  it('reports no recording when the account has none', () => {
    const items = build({ calls: [call({ sid: 'c1' })] }) as CallItemDto[];
    expect(items[0].hasRecording).toBe(false);
  });
});
