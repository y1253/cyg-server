import {
  ACCEPT_DIGIT,
  SCREEN_TIMEOUT_SEC,
  spokenDigits,
  whisperDoc,
  whisperRepeat,
  whisperText,
} from './call-screen.util';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const ACTION = 'https://example.test/api/phone/voice/screen-accept';

describe('spokenDigits', () => {
  it('spaces the digits so TTS reads them one at a time', () => {
    // Unspaced, every engine tried this read it as a cardinal number
    // ("five hundred fourteen billion…"), which is useless to somebody deciding
    // whether to take a call.
    expect(spokenDigits('+15145550001')).toBe('5 1 4 5 5 5 0 0 0 1');
  });

  it('drops a NANP country code but keeps any other', () => {
    expect(spokenDigits('+15145550001')).not.toMatch(/^1 /);
    expect(spokenDigits('+442071234567')).toBe('4 4 2 0 7 1 2 3 4 5 6 7');
  });

  it('is empty for a withheld caller rather than speaking nothing aloud', () => {
    expect(spokenDigits('')).toBe('');
    expect(spokenDigits(null)).toBe('');
    expect(spokenDigits(undefined)).toBe('');
  });
});

describe('whisperText', () => {
  it('names the company and the caller', () => {
    expect(
      whisperText({
        companyName: 'Acme Bookkeeping',
        from: '+15145550001',
        fromName: null,
      }),
    ).toBe(
      'Call for Acme Bookkeeping from 5 1 4 5 5 5 0 0 0 1. Press 1 to accept.',
    );
  });

  it('prefers a saved contact name to the digits', () => {
    expect(
      whisperText({
        companyName: 'Acme Bookkeeping',
        from: '+15145550001',
        fromName: 'Dana Fisher',
      }),
    ).toBe('Call for Acme Bookkeeping from Dana Fisher. Press 1 to accept.');
  });

  it('DEGRADES without a company, and still asks for the keypress', () => {
    // The expectation registry is in-process, so a restart mid-ring loses it. The caller's
    // number still comes off the webhook body; only which client it is about is lost. What
    // must survive is the accept.
    const text = whisperText({
      companyName: null,
      from: '+15145550001',
      fromName: null,
    });
    expect(text).toBe(
      'You have a business call from 5 1 4 5 5 5 0 0 0 1. Press 1 to accept.',
    );
    expect(text).toContain(`Press ${ACCEPT_DIGIT} to accept.`);
  });

  it('omits the caller clause entirely when the number is withheld', () => {
    expect(whisperText({ companyName: 'Acme', from: '', fromName: null })).toBe(
      'Call for Acme. Press 1 to accept.',
    );
  });
});

describe('whisperDoc', () => {
  it('pauses, gathers ONE dtmf digit, says it twice, then hangs up', () => {
    expect(
      whisperDoc({
        companyName: 'Acme Bookkeeping',
        from: '+15145550001',
        fromName: 'Dana Fisher',
        action: ACTION,
      }),
    ).toBe(
      `${DECL}<Response>` +
        '<Pause length="1"/>' +
        `<Gather input="dtmf" numDigits="1" timeout="${SCREEN_TIMEOUT_SEC}" ` +
        `action="${ACTION}" method="POST">` +
        '<Say>Call for Acme Bookkeeping from Dana Fisher. Press 1 to accept.</Say>' +
        `<Say>${whisperRepeat()}</Say>` +
        '</Gather>' +
        '<Hangup/>' +
        '</Response>',
    );
  });

  it('puts <Hangup/> AFTER the <Gather>, which is the whole reject path', () => {
    // <Gather> with no input falls through to the next verb, so silence — a carrier
    // voicemail, a pocket — ends THIS LEG ONLY. The <Dial> goes on ringing the browsers and
    // still falls through to the COMPANY's voicemail. Inside the <Gather> it would hang up
    // before anyone could press anything.
    const xml = whisperDoc({
      companyName: 'Acme',
      from: '+15145550001',
      fromName: null,
      action: ACTION,
    });
    expect(xml.indexOf('</Gather>')).toBeLessThan(xml.indexOf('<Hangup/>'));
  });

  it('emits input="dtmf" explicitly rather than taking the provider default', () => {
    // A default of `dtmf speech` would bill speech recognition on every screened call in
    // order to hear one keypress.
    expect(
      whisperDoc({
        companyName: 'Acme',
        from: '',
        fromName: null,
        action: ACTION,
      }),
    ).toContain('input="dtmf"');
  });

  it('escapes the company name exactly once', () => {
    // Plain text out of whisperText, escaped once at the <Say> boundary — the phone-module
    // convention. Escaping on both sides gives O&amp;apos;Brien, read out entity by entity.
    const xml = whisperDoc({
      companyName: "O'Brien Books",
      from: '',
      fromName: null,
      action: ACTION,
    });
    expect(xml).toContain('<Say>Call for O&apos;Brien Books.');
    expect(xml).not.toContain('&amp;apos;');
  });

  it('passes the configured voice through so it matches the rest of the line', () => {
    expect(
      whisperDoc({
        companyName: 'Acme',
        from: '',
        fromName: null,
        action: ACTION,
        voice: 'alice',
      }),
    ).toContain('<Say voice="alice">');
  });
});
