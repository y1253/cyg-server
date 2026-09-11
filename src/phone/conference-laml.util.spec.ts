import { conferenceDoc } from './conference-laml.util';

const ROOM = 'cyg-b9c4489d-f26c-4cf0-96cb-23d8c50398d4';
const REC = { PHONE_RECORD_CALLS: '1' };
const NO_REC = { PHONE_RECORD_CALLS: '0' };

describe('conferenceDoc — the three role documents, byte for byte', () => {
  it('builds the agent document', () => {
    expect(
      conferenceDoc({ room: ROOM, role: 'agent', isRoot: false, env: REC }),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">${ROOM}</Conference></Dial>` +
        '</Response>',
    );
  });

  it('builds a party document', () => {
    expect(
      conferenceDoc({ room: ROOM, role: 'party', isRoot: false, env: REC }),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="onEnter">${ROOM}</Conference></Dial>` +
        '</Response>',
    );
  });
});

describe('endConferenceOnExit — the agent, and only the agent', () => {
  /**
   * The whole safety property of this feature. With `false` on the agent, hanging up
   * would leave a client and an outside third party connected on our bill, with no UI
   * anywhere able to end it.
   */
  it('is true for the agent', () => {
    expect(
      conferenceDoc({ room: ROOM, role: 'agent', isRoot: true, env: REC }),
    ).toContain('endConferenceOnExit="true"');
  });

  it('is false for every party, root or not', () => {
    for (const isRoot of [true, false]) {
      expect(
        conferenceDoc({ room: ROOM, role: 'party', isRoot, env: REC }),
      ).toContain('endConferenceOnExit="false"');
    }
  });
});

describe('record follows the ROOT, never the role', () => {
  /**
   * A redirect drops every attribute the previous <Dial> carried. The recording lives on
   * the leg the original <Dial> ran on — the customer inbound, the agent's SIP leg
   * outbound — so attaching it by role would record the wrong leg in one direction and
   * produce two files in the other.
   */
  it('records the root leg whichever role it is', () => {
    for (const role of ['agent', 'party'] as const) {
      expect(
        conferenceDoc({ room: ROOM, role, isRoot: true, env: REC }),
      ).toContain('record="record-from-answer-dual"');
    }
  });

  it('never records a non-root leg', () => {
    for (const role of ['agent', 'party'] as const) {
      expect(
        conferenceDoc({ room: ROOM, role, isRoot: false, env: REC }),
      ).not.toContain('record=');
    }
  });

  it('honours PHONE_RECORD_CALLS=0 even on the root', () => {
    expect(
      conferenceDoc({ room: ROOM, role: 'party', isRoot: true, env: NO_REC }),
    ).not.toContain('record=');
  });

  it('puts record on the <Dial>, never on the <Conference> noun', () => {
    // They are different, differently-billed features. A conference recording is filed
    // against the conference sid, where listRecordings({callSid}) would never find it —
    // so the timeline would silently report "no recording" for these calls.
    const xml = conferenceDoc({
      room: ROOM,
      role: 'party',
      isRoot: true,
      env: REC,
    });
    expect(xml).toContain('<Dial record="record-from-answer-dual">');
    expect(xml).toMatch(/<Conference [^>]*>/);
    expect(/<Conference [^>]*record=/.test(xml)).toBe(false);
  });
});

describe('no document may carry an action', () => {
  /**
   * The single worst bug this route could grow. `voice/dial-status`'s first branch joins
   * a conference; if the conference <Dial> also had an `action`, the room ENDING would
   * re-enter that branch and park the leg in a room that no longer exists, forever.
   */
  it('omits action for every role and both root values', () => {
    for (const role of ['agent', 'party'] as const) {
      for (const isRoot of [true, false]) {
        expect(
          conferenceDoc({
            room: ROOM,
            role,
            isRoot,
            holdUrl: 'https://x.test/api/phone/voice/conference-wait',
            statusCallback: 'https://x.test/api/phone/voice/conference-status',
            env: REC,
          }),
        ).not.toContain('action=');
      }
    }
  });
});

describe('hold audio and lifecycle events', () => {
  it('emits waitUrl as a signed POST when a hold url is given', () => {
    const xml = conferenceDoc({
      room: ROOM,
      role: 'party',
      isRoot: false,
      holdUrl: 'https://x.test/api/phone/voice/conference-wait',
      env: REC,
    });
    expect(xml).toContain(
      'waitUrl="https://x.test/api/phone/voice/conference-wait"',
    );
    // POST, so the one existing signature rule covers it. A GET would be signed over the
    // URL alone — a second rule, in a module that has already paid twice for getting
    // webhook signatures wrong.
    expect(xml).toContain('waitMethod="POST"');
  });

  it('omits waitUrl entirely when no track is configured', () => {
    // Deliberately absent rather than `waitUrl=""`: empty means SILENCE, while omitted
    // takes SignalWire's own hold music. Provider music beats silence.
    expect(
      conferenceDoc({ room: ROOM, role: 'party', isRoot: false, env: REC }),
    ).not.toContain('waitUrl');
  });

  it('carries the lifecycle callback only where the caller asks for it', () => {
    // It is set on ONE document (the agent's). On every noun it would register the
    // callback several times over and produce duplicate join/leave events.
    expect(
      conferenceDoc({
        room: ROOM,
        role: 'agent',
        isRoot: false,
        statusCallback: 'https://x.test/api/phone/voice/conference-status',
        env: REC,
      }),
    ).toContain('statusCallbackEvent="start end join leave"');

    expect(
      conferenceDoc({ room: ROOM, role: 'party', isRoot: false, env: REC }),
    ).not.toContain('statusCallback');
  });
});
