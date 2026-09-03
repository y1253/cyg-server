import {
  dialNumber,
  dialSip,
  emptyResponse,
  esc,
  hangup,
  say,
  sayAndHangup,
  sayThenDialSip,
  sayThenRecord,
  recordVerb,
} from './laml.util';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

describe('esc', () => {
  it('escapes all five XML entities', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('escapes & first so entities are not double-escaped', () => {
    // Getting the order wrong turns `<` into `&amp;lt;` and the caller hears the
    // literal text. Only visible if & is replaced before the others.
    expect(esc('<')).toBe('&lt;');
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('renders null and undefined as empty, not as "null"', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('emptyResponse', () => {
  it('is a well-formed empty Response, not an empty body', () => {
    // The distinction that caused "this call cannot be completed": a 404 or an
    // empty body is not a valid answer, an empty <Response> is.
    expect(emptyResponse()).toBe(`${DECL}<Response></Response>`);
  });
});

describe('say', () => {
  it('wraps the text in Say inside Response', () => {
    expect(say('Please hold')).toBe(
      `${DECL}<Response><Say>Please hold</Say></Response>`,
    );
  });

  it('escapes an apostrophe in a company name', () => {
    // The real case: "O'Brien Bookkeeping" reaching <Say> unescaped produces XML
    // SignalWire rejects, and the caller hears the generic failure instead.
    expect(say("O'Brien Bookkeeping")).toContain(
      '<Say>O&apos;Brien Bookkeeping</Say>',
    );
  });

  it('adds the voice attribute only when given', () => {
    expect(say('hi', { voice: 'alice' })).toContain('<Say voice="alice">');
    expect(say('hi')).toContain('<Say>');
  });
});

describe('sayAndHangup / hangup', () => {
  it('speaks then hangs up, in that order', () => {
    expect(sayAndHangup('Bye')).toBe(
      `${DECL}<Response><Say>Bye</Say><Hangup/></Response>`,
    );
  });

  it('hangup alone', () => {
    expect(hangup()).toBe(`${DECL}<Response><Hangup/></Response>`);
  });
});

describe('dialSip', () => {
  it('emits one Sip noun with the sip: scheme', () => {
    expect(dialSip([{ uri: 'cyg_u12@cygfinance.sip.signalwire.com' }])).toBe(
      `${DECL}<Response><Dial><Sip>sip:cyg_u12@cygfinance.sip.signalwire.com</Sip></Dial></Response>`,
    );
  });

  it('puts MULTIPLE Sip nouns inside ONE Dial so they ring simultaneously', () => {
    // Load-bearing for the unassigned-company fallback (ring all admins). Separate
    // <Dial> verbs would ring them one after another, which is a different feature.
    const xml = dialSip([{ uri: 'a@d' }, { uri: 'b@d' }, { uri: 'c@d' }]);
    expect(xml.match(/<Dial/g)).toHaveLength(1);
    expect(xml.match(/<Sip>/g)).toHaveLength(3);
    expect(xml).toContain(
      '<Sip>sip:a@d</Sip><Sip>sip:b@d</Sip><Sip>sip:c@d</Sip>',
    );
  });

  it('folds custom headers into the URI as query params', () => {
    // How the browser learns which company was dialled — the INVITE otherwise only
    // carries the user's own SIP identity, which says nothing about the company.
    expect(
      dialSip([{ uri: 'cyg_u7@d', headers: { 'X-Company-Id': 42 } }]),
    ).toContain('<Sip>sip:cyg_u7@d?X-Company-Id=42</Sip>');
  });

  it('joins multiple headers with & — XML-escaped, so it survives as &amp;', () => {
    const xml = dialSip([
      { uri: 'u@d', headers: { 'X-Company-Id': 1, 'X-Call-Sid': 'CA9' } },
    ]);
    expect(xml).toContain('X-Company-Id=1&amp;X-Call-Sid=CA9');
    expect(xml).not.toContain('X-Company-Id=1&X-Call-Sid');
  });

  it('URL-encodes a header value before escaping it', () => {
    const xml = dialSip([{ uri: 'u@d', headers: { 'X-Name': 'A & B Ltd' } }]);
    expect(xml).toContain('X-Name=A%20%26%20B%20Ltd');
  });

  it('emits attributes only when supplied', () => {
    expect(
      dialSip([{ uri: 'u@d' }], {
        timeout: 20,
        callerId: '+1438',
        action: '/x',
      }),
    ).toContain('<Dial timeout="20" callerId="+1438" action="/x">');
    expect(dialSip([{ uri: 'u@d' }])).toContain('<Dial>');
  });
});

describe('dialNumber', () => {
  it('dials PSTN with the company support number as caller ID', () => {
    expect(dialNumber('+15145551234', { callerId: '+14382561176' })).toBe(
      `${DECL}<Response><Dial callerId="+14382561176"><Number>+15145551234</Number></Dial></Response>`,
    );
  });
});

describe('dial recording', () => {
  it('emits the record attribute on a SIP ring group', () => {
    expect(
      dialSip([{ uri: 'testcyg@x.sip.signalwire.com' }], {
        timeout: 30,
        record: 'record-from-answer-dual',
      }),
    ).toContain('record="record-from-answer-dual"');
  });

  it('emits it on an outbound PSTN dial too', () => {
    // Inbound and outbound must both record, or "click a call, hear the recording"
    // works for only half the timeline.
    expect(
      dialNumber('+15551112222', {
        callerId: '+14382561210',
        record: 'record-from-answer-dual',
      }),
    ).toContain('record="record-from-answer-dual"');
  });

  it('omits the attribute entirely when recording is off', () => {
    // Absent, not record="do-not-record": the attribute's own default is
    // do-not-record, and emitting nothing keeps the LaML identical to what shipped
    // before recording existed.
    const xml = dialSip([{ uri: 'a@b' }], { timeout: 30 });
    expect(xml).not.toContain('record');
  });

  it('keeps every other attribute alongside it', () => {
    const xml = dialNumber('+15551112222', {
      timeout: 20,
      callerId: '+14382561210',
      action: 'https://example.com/api/phone/voice/status',
      record: 'record-from-answer-dual',
    });
    expect(xml).toContain('timeout="20"');
    expect(xml).toContain('callerId="+14382561210"');
    expect(xml).toContain(
      'action="https://example.com/api/phone/voice/status"',
    );
    expect(xml).toContain('record="record-from-answer-dual"');
  });

  it('escapes the value rather than trusting it', () => {
    expect(dialSip([{ uri: 'a@b' }], { record: 'x"y' })).toContain(
      'record="x&quot;y"',
    );
  });
});

describe('sayThenDialSip', () => {
  // The verb-fragment refactor exists for this one builder. Every assertion ABOVE this
  // block is unchanged from before it, which is what makes them the regression proof.

  it('puts Say and Dial in ONE Response, in that order', () => {
    const xml = sayThenDialSip('Please hold', [{ uri: 'u@d' }]);
    expect(xml).toBe(
      `${DECL}<Response><Say>Please hold</Say><Dial><Sip>sip:u@d</Sip></Dial></Response>`,
    );
  });

  it('emits exactly one envelope, one Say and one Dial', () => {
    // Composing two builders that each wrap themselves would produce nested Responses,
    // which SignalWire rejects outright.
    const xml = sayThenDialSip('hi', [{ uri: 'a@d' }, { uri: 'b@d' }]);
    expect(xml.match(/<Response>/g)).toHaveLength(1);
    expect(xml.match(/<Say/g)).toHaveLength(1);
    expect(xml.match(/<Dial/g)).toHaveLength(1);
    expect(xml.match(/<Sip>/g)).toHaveLength(2);
  });

  it('ORDER: Say comes before Dial', () => {
    // Reversed, the greeting plays to nobody — the call has already connected or ended.
    const xml = sayThenDialSip('greeting', [{ uri: 'u@d' }]);
    expect(xml.indexOf('<Say')).toBeLessThan(xml.indexOf('<Dial'));
  });

  it('with null text is BYTE-IDENTICAL to dialSip', () => {
    // This is what makes "do not play a greeting" a zero-risk setting rather than an
    // empty <Say> of uncertain behaviour.
    const opts = { timeout: 30, record: 'record-from-answer-dual' };
    expect(sayThenDialSip(null, [{ uri: 'u@d' }], opts)).toBe(
      dialSip([{ uri: 'u@d' }], opts),
    );
  });

  it('puts voice on Say and NEVER on Dial', () => {
    // <Dial voice="..."> is not a thing; leaking it through dialAttrs emits an attribute
    // SignalWire may reject.
    const xml = sayThenDialSip('hi', [{ uri: 'u@d' }], {
      voice: 'alice',
      timeout: 20,
    });
    expect(xml).toContain('<Say voice="alice">');
    expect(xml).toContain('<Dial timeout="20">');
    expect(xml).not.toContain('<Dial voice');
  });

  it('carries the dial attributes through unchanged', () => {
    const xml = sayThenDialSip('hi', [{ uri: 'u@d' }], {
      timeout: 45,
      record: 'record-from-answer-dual',
    });
    expect(xml).toContain('timeout="45"');
    expect(xml).toContain('record="record-from-answer-dual"');
  });

  it('escapes the spoken text', () => {
    expect(sayThenDialSip("O'Brien Bookkeeping", [{ uri: 'u@d' }])).toContain(
      '<Say>O&apos;Brien Bookkeeping</Say>',
    );
  });

  it('treats empty text as no greeting at all', () => {
    // '' is falsy on purpose: a blank message must not emit <Say></Say>.
    expect(sayThenDialSip('', [{ uri: 'u@d' }])).toBe(
      dialSip([{ uri: 'u@d' }]),
    );
  });
});

describe('recordVerb', () => {
  it('emits a bare, self-closing fragment with no envelope', () => {
    expect(recordVerb()).toBe('<Record/>');
  });

  it('escapes the action URL', () => {
    // An unescaped & in a query string breaks the whole document, which reaches the
    // caller as "this call cannot be completed" with nothing in the log.
    expect(recordVerb({ action: 'https://x.test/a?b=1&c=2' })).toBe(
      '<Record action="https://x.test/a?b=1&amp;c=2"/>',
    );
  });

  it('emits playBeep="false" rather than omitting it', () => {
    // Omitting takes the provider default, which is ON — so "no beep" has to be stated.
    expect(recordVerb({ playBeep: false })).toBe('<Record playBeep="false"/>');
    expect(recordVerb({})).toBe('<Record/>');
  });

  it('keeps maxLength at 0 rather than treating it as absent', () => {
    expect(recordVerb({ maxLength: 0 })).toBe('<Record maxLength="0"/>');
  });
});

describe('sayThenRecord', () => {
  it('puts <Say> BEFORE <Record>', () => {
    // Order is load-bearing: reversed, the beep starts while the caller is still being
    // told what to do, and they talk over the instruction they never heard.
    expect(sayThenRecord('Leave a message.', { maxLength: 120 })).toBe(
      `${DECL}<Response><Say>Leave a message.</Say>` +
        '<Record maxLength="120"/></Response>',
    );
  });

  it('emits no <Say> at all when the prompt is null', () => {
    expect(sayThenRecord(null)).toBe(`${DECL}<Response><Record/></Response>`);
  });

  it('passes voice to <Say> and never to <Record>', () => {
    const xml = sayThenRecord('Hi.', { voice: 'alice', maxLength: 30 });
    expect(xml).toContain('<Say voice="alice">Hi.</Say>');
    expect(xml).toContain('<Record maxLength="30"/>');
    expect(xml).not.toContain('<Record voice');
  });
});
