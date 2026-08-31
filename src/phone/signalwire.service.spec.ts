import { BadGatewayException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SignalWireService } from './signalwire.service';

const PROJECT = 'proj-123';
const TOKEN = 'tok-456';

function configWith(space: string) {
  return {
    getOrThrow: (key: string) =>
      ({
        SIGNALWIRE_SPACE_URL: space,
        SIGNALWIRE_PROJECT_ID: PROJECT,
        SIGNALWIRE_API_TOKEN: TOKEN,
      })[key],
    get: () => undefined,
  } as unknown as ConfigService;
}

interface Captured {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** Captures the outgoing request and replies with a canned response. */
function mockFetch(reply: { status?: number; body?: string } = {}): Captured[] {
  const calls: Captured[] = [];
  global.fetch = jest.fn((url: unknown, init: unknown) => {
    calls.push({
      url: String(url),
      init: init as Captured['init'],
    });
    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(reply.body ?? '{}'),
    } as Response);
  }) as unknown as typeof fetch;
  return calls;
}

function decodeAuth(header: string): string {
  return Buffer.from(header.replace(/^Basic /, ''), 'base64').toString();
}

describe('SignalWireService request construction', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds the URL from the BARE space host and authenticates with Basic auth', async () => {
    // The env var holds a bare hostname. A stray protocol or a wrong auth encoding
    // would otherwise only surface on the first real call, in production.
    const calls = mockFetch({ body: '{"available_phone_numbers":[]}' });
    const service = new SignalWireService(
      configWith('cygfinance.signalwire.com'),
    );
    await service.searchAvailable('CA');

    expect(calls[0].url).toBe(
      `https://cygfinance.signalwire.com/api/laml/2010-04-01/Accounts/${PROJECT}/AvailablePhoneNumbers/CA/Local`,
    );
    expect(decodeAuth(calls[0].init.headers.Authorization)).toBe(
      `${PROJECT}:${TOKEN}`,
    );
  });

  it('tolerates a protocol accidentally pasted into SIGNALWIRE_SPACE_URL', async () => {
    const calls = mockFetch({ body: '{"available_phone_numbers":[]}' });
    const service = new SignalWireService(
      configWith('https://cygfinance.signalwire.com/'),
    );
    await service.searchAvailable('US');

    expect(calls[0].url).toContain(
      'https://cygfinance.signalwire.com/api/laml',
    );
    expect(calls[0].url).not.toContain('https://https://');
  });

  it('sends AreaCode and InRegion only when supplied, never as empty params', async () => {
    const calls = mockFetch({ body: '{"available_phone_numbers":[]}' });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await service.searchAvailable('CA');
    expect(calls[0].url).not.toContain('AreaCode');
    expect(calls[0].url).not.toContain('InRegion');

    await service.searchAvailable('CA', { inRegion: 'QC', areaCode: '438' });
    expect(calls[1].url).toContain('AreaCode=438');
    expect(calls[1].url).toContain('InRegion=QC');
  });
});

describe('SignalWireService.purchaseNumber', () => {
  afterEach(() => jest.restoreAllMocks());

  const OK_BODY = JSON.stringify({
    sid: 'sid-1',
    phone_number: '+14382560856',
    friendly_name: 'Acme',
    capabilities: { voice: true, SMS: true, MMS: false },
  });

  it('buys AND configures both webhooks in ONE form-encoded request', async () => {
    // The single call is a correctness property: a buy-then-configure pair leaves a
    // window where we own a live number routing nowhere. A future split must fail here.
    const calls = mockFetch({ status: 201, body: OK_BODY });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    const result = await service.purchaseNumber({
      phoneNumber: '+14382560856',
      friendlyName: 'Acme Bookkeeping',
      voiceUrl: 'https://app/api/phone/voice/inbound',
      smsUrl: 'https://app/api/phone/sms/inbound',
      statusCallback: 'https://app/api/phone/voice/status',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );

    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get('PhoneNumber')).toBe('+14382560856');
    expect(body.get('FriendlyName')).toBe('Acme Bookkeeping');
    expect(body.get('VoiceUrl')).toBe('https://app/api/phone/voice/inbound');
    expect(body.get('SmsUrl')).toBe('https://app/api/phone/sms/inbound');
    expect(body.get('VoiceMethod')).toBe('POST');
    expect(body.get('SmsMethod')).toBe('POST');
    expect(result.sid).toBe('sid-1');
  });

  it('throws when the purchase body cannot be read, so the caller can compensate', async () => {
    // We may already have been billed; the SID we failed to parse is the only handle
    // for releasing it, so this must be loud rather than a silent undefined.
    mockFetch({ status: 201, body: '<html>gateway</html>' });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(
      service.purchaseNumber({ phoneNumber: '+14382560856' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('SignalWireService.releaseNumber', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves on a 204 with an empty body', async () => {
    // JSON.parse('') throws. If that ever leaks, releasing a number starts failing and
    // we keep paying for it — which is why this case is handled explicitly.
    const calls = mockFetch({ status: 204, body: '' });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(service.releaseNumber('sid-1')).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url).toContain('/IncomingPhoneNumbers/sid-1');
  });

  it('treats a 404 as already released rather than an error', async () => {
    // Otherwise the row is stranded "active" with no number behind it, and no retry
    // can ever clear it.
    mockFetch({ status: 404, body: '{"code":20404,"message":"Not Found"}' });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(service.releaseNumber('sid-gone')).resolves.toBeUndefined();
  });

  it('still throws on a real server error', async () => {
    mockFetch({ status: 500, body: '{"message":"boom"}' });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(service.releaseNumber('sid-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

describe('SignalWireService error mapping', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a 4xx to BadGatewayException carrying the provider message', async () => {
    mockFetch({
      status: 400,
      body: '{"code":21422,"message":"Phone number is not available"}',
    });
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(
      service.purchaseNumber({ phoneNumber: '+14382560856' }),
    ).rejects.toThrow(/Phone number is not available/);
  });

  it('maps a timeout to BadGatewayException without leaking AbortError', async () => {
    global.fetch = jest.fn(() => {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(service.searchAvailable('CA')).rejects.toThrow(
      /Phone service timed out/,
    );
  });

  it('maps a network failure to BadGatewayException', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch;
    const service = new SignalWireService(configWith('space.signalwire.com'));

    await expect(service.searchAvailable('CA')).rejects.toThrow(
      /Phone service unreachable/,
    );
  });
});

describe('SignalWireService timeline requests', () => {
  afterEach(() => jest.restoreAllMocks());

  const service = () => new SignalWireService(configWith('space.example.com'));

  it('sends date filters as a FULL ISO timestamp, never a bare date', async () => {
    // The single most expensive thing to get wrong here. SignalWire honours the time
    // component and reads a bare `YYYY-MM-DD` as MIDNIGHT — verified live, where
    // `StartTime<2026-08-27` returned 0 rows and `StartTime<2026-08-27T23:59:59Z`
    // returned 145. Truncating the cursor to its date part would silently discard
    // every row from the cursor's own day on every page of the timeline.
    const calls = mockFetch({ body: '{"calls":[]}' });
    await service().listCalls({
      to: '+14382561210',
      after: Date.UTC(2026, 7, 1, 9, 30, 0),
      before: Date.UTC(2026, 7, 27, 23, 59, 59),
    });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('StartTime>')).toBe('2026-08-01T09:30:00.000Z');
    expect(url.searchParams.get('StartTime<')).toBe('2026-08-27T23:59:59.000Z');
    // A date-shaped value here means the bug is back.
    expect(url.searchParams.get('StartTime<')).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('omits date filters entirely when no window is given', async () => {
    const calls = mockFetch({ body: '{"calls":[]}' });
    await service().listCalls({ to: '+14382561210' });
    const url = new URL(calls[0].url);
    expect(url.searchParams.has('StartTime>')).toBe(false);
    expect(url.searchParams.has('StartTime<')).toBe(false);
    expect(url.searchParams.get('To')).toBe('+14382561210');
  });

  it('accepts a SIP URI as the To filter — how missed inbound calls are found', async () => {
    // The parent leg of an unanswered inbound call reports `completed`; only the SIP
    // child leg says `no-answer`. Fetching those legs is the only way to tell the two
    // apart, and it depends on this filter accepting a SIP URI.
    const calls = mockFetch({ body: '{"calls":[]}' });
    await service().listCalls({ to: 'sip:testcyg@x.sip.signalwire.com' });
    expect(new URL(calls[0].url).searchParams.get('To')).toBe(
      'sip:testcyg@x.sip.signalwire.com',
    );
  });

  it('sends both To and From when both are given — SignalWire ANDs them', async () => {
    const calls = mockFetch({ body: '{"messages":[]}' });
    await service().listMessages({ to: '+15551112222', from: '+14382561210' });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('To')).toBe('+15551112222');
    expect(url.searchParams.get('From')).toBe('+14382561210');
  });

  it('asks for a page big enough that nothing needs a second request', async () => {
    // next_page_uri is a path rooted at /api/laml and cannot be appended to the
    // account-scoped base URL, so nothing follows it. One large page per window is
    // the whole pagination strategy.
    const calls = mockFetch({ body: '{"calls":[]}' });
    await service().listCalls({});
    expect(new URL(calls[0].url).searchParams.get('PageSize')).toBe('200');
  });

  it('lists recordings account-wide when no call is named', async () => {
    const calls = mockFetch({ body: '{"recordings":[]}' });
    await service().listRecordings();
    const url = new URL(calls[0].url);
    expect(url.pathname).toMatch(/\/Recordings$/);
    expect(url.searchParams.has('CallSid')).toBe(false);
  });

  it('posts an SMS form-encoded and returns the parsed message', async () => {
    const calls = mockFetch({
      status: 201,
      body: JSON.stringify({
        sid: 'm-1',
        to: '+15551112222',
        from: '+14382561210',
        direction: 'outbound-api',
        status: 'queued',
        body: 'hi',
        num_media: 0,
        date_created: 'Sun, 30 Aug 2026 14:23:42 +0000',
      }),
    });
    const sent = await service().sendSms({
      to: '+15551112222',
      from: '+14382561210',
      body: 'hi',
    });

    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(calls[0].init.body as string);
    expect(form.get('To')).toBe('+15551112222');
    expect(form.get('From')).toBe('+14382561210');
    expect(form.get('Body')).toBe('hi');
    expect(sent.sid).toBe('m-1');
  });

  it('carries the LaML inline on createCall, with no callback Url', async () => {
    // Click-to-call needs no publicly reachable webhook: the <Dial> travels in the
    // request. That removes a whole signature surface — and this module has already
    // lost two deploy cycles to webhook-signature mistakes.
    const calls = mockFetch({
      status: 201,
      body: JSON.stringify({
        sid: 'c-1',
        to: 'sip:testcyg@x.sip.signalwire.com',
        from: '+14382561210',
        direction: 'outbound-api',
        status: 'queued',
        duration: 0,
        date_created: 'Sun, 30 Aug 2026 14:23:42 +0000',
      }),
    });
    const created = await service().createCall({
      to: 'sip:testcyg@x.sip.signalwire.com',
      from: '+14382561210',
      laml: '<Response><Dial><Number>+15551112222</Number></Dial></Response>',
      statusCallback: 'https://example.com/api/phone/voice/status',
    });

    const form = new URLSearchParams(calls[0].init.body as string);
    expect(form.get('Laml')).toContain('<Number>+15551112222</Number>');
    expect(form.get('To')).toBe('sip:testcyg@x.sip.signalwire.com');
    expect(form.get('From')).toBe('+14382561210');
    expect(form.has('Url')).toBe(false);
    expect(created.sid).toBe('c-1');
  });

  it('reports an unreadable send response rather than pretending it failed', async () => {
    // The SMS may well have gone out; only its id is lost. The caller must not
    // retry blindly, so this is a 502, and the log line above it says so.
    const service2 = service();
    mockFetch({ status: 201, body: '{"nonsense":true}' });
    await expect(
      service2.sendSms({ to: '+1555', from: '+1438', body: 'x' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
