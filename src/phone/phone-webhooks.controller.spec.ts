import type { Request } from 'express';
import { PhoneWebhooksController } from './phone-webhooks.controller';
import { SIGNATURE_HEADER, computeSignature } from './signature.util';
import { webhookUrls } from './phone.config';
import type { CallRoutingService } from './call-routing.service';
import type { PhoneEventsService } from './phone-events.service';
import type { PhoneTimelineService } from './phone-timeline.service';
import type { PhoneSettingsService } from '../phone-settings/phone-settings.service';
import type { CallSummaryService } from './call-summary.service';
import {
  FALLBACK_WEEK,
  HARDCODED_FALLBACK,
  SEED_DEFAULTS,
  type EffectivePhoneSettings,
  type WeeklyHours,
} from '../phone-settings/phone-settings.util';

const SIGN_KEY = 'test-signing-key';
const SIP = 'testcyg@cyg-abc.sip.signalwire.com';
const TO = '+14382561210';
const FROM = '+15145550001';
const CALL_SID = 'b9c4489d-f26c-4cf0-96cb-23d8c50398d4';

/** Thursday 12:00 in Toronto (EST). Inside a Mon-Fri 09:00-17:00 week. */
const DURING_HOURS = new Date('2026-01-15T17:00:00Z');
/** Thursday 22:00 in Toronto (EST). Outside it. */
const AFTER_HOURS = new Date('2026-01-16T03:00:00Z');

const ROUTE = {
  companyId: 90,
  companyName: 'Acme Bookkeeping',
  targetUserIds: [16],
  viaAdminFallback: false,
};

function settings(
  over: Partial<EffectivePhoneSettings> = {},
): EffectivePhoneSettings {
  return {
    ...SEED_DEFAULTS,
    weeklyHours: FALLBACK_WEEK,
    hoursEnabled: true,
    greetingMessage: 'Greeting for {company name}.',
    afterHoursMessage: 'Closed message for {company name}.',
    unavailableMessage: 'Nobody available.',
    // Pinned OFF here, not inherited from SEED_DEFAULTS, even though this is what the
    // seed says today. Every test above predates voicemail and asserts the shape of the
    // LaML WITHOUT it -- so "voicemail is off" is part of what they are testing, and
    // leaving it to a default meant flipping that default rewrote six assertions that
    // had nothing to do with the change. `vmSettings()` is the opt-in.
    voicemailEnabled: false,
    ...over,
  };
}

function build(opts: {
  route?: typeof ROUTE | null;
  settings?: EffectivePhoneSettings;
  sipConfigured?: boolean;
}) {
  const routing = {
    resolve: jest
      .fn()
      .mockResolvedValue(opts.route === undefined ? ROUTE : opts.route),
  };
  const events = { broadcastIncomingCall: jest.fn(), clearRinging: jest.fn() };
  const timeline = { bust: jest.fn() };
  const phoneSettings = {
    effectiveFor: jest.fn().mockResolvedValue(opts.settings ?? settings()),
  };
  const summaries = { enqueue: jest.fn().mockResolvedValue(undefined) };

  if (opts.sipConfigured === false) {
    delete process.env.SIGNALWIRE_SIP_DOMAIN;
    delete process.env.SIGNALWIRE_SIP_USERNAME;
    delete process.env.SIGNALWIRE_SIP_PASSWORD;
  } else {
    process.env.SIGNALWIRE_SIP_DOMAIN = 'cyg-abc.sip.signalwire.com';
    process.env.SIGNALWIRE_SIP_USERNAME = 'testcyg';
    process.env.SIGNALWIRE_SIP_PASSWORD = 'pw';
  }

  return {
    controller: new PhoneWebhooksController(
      routing as unknown as CallRoutingService,
      events as unknown as PhoneEventsService,
      timeline as unknown as PhoneTimelineService,
      phoneSettings as unknown as PhoneSettingsService,
      summaries as unknown as CallSummaryService,
    ),
    events,
    routing,
    timeline,
    phoneSettings,
    summaries,
  };
}

/** A genuinely signed inbound-call request, so the real guard runs rather than a stub. */
function signedRequest(body: Record<string, string>) {
  const url = webhookUrls(process.env).voiceUrl;
  const signature = computeSignature(url, body, SIGN_KEY);
  return { headers: { [SIGNATURE_HEADER]: signature } } as unknown as Request;
}

const BODY = { From: FROM, To: TO, CallSid: CALL_SID };

describe('PhoneWebhooksController.voiceInbound', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
    process.env.PHONE_RECORD_CALLS = '0'; // keep the XML assertions about hours, not recording
    jest.useFakeTimers().setSystemTime(DURING_HOURS);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });

  it('rejects an unsigned request before doing anything else', async () => {
    const { controller, routing } = build({});
    await expect(
      controller.voiceInbound({ headers: {} } as unknown as Request, BODY),
    ).rejects.toThrow('Invalid signature');
    expect(routing.resolve).not.toHaveBeenCalled();
  });

  // ── Case 1: open, greeting on ──────────────────────────────────────────────

  it('speaks the greeting and THEN dials, in one Response', async () => {
    const { controller, events } = build({});
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Greeting for Acme Bookkeeping.</Say>');
    expect(xml).toContain(`<Sip>sip:${SIP}</Sip>`);
    expect(xml.indexOf('<Say')).toBeLessThan(xml.indexOf('<Dial'));
    expect(xml.match(/<Response>/g)).toHaveLength(1);
    expect(events.broadcastIncomingCall).toHaveBeenCalledTimes(1);
  });

  it('uses the configured ring timeout rather than a hardcoded 30', async () => {
    const { controller } = build({
      settings: settings({ ringTimeoutSeconds: 45 }),
    });
    expect(await controller.voiceInbound(signedRequest(BODY), BODY)).toContain(
      'timeout="45"',
    );
  });

  // ── Case 2: open, greeting off ─────────────────────────────────────────────

  it('with the greeting off, emits no Say at all', async () => {
    // Byte-identical to the LaML that shipped before this feature.
    const { controller, events } = build({
      settings: settings({ playGreeting: false }),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).not.toContain('<Say');
    expect(xml).toContain('<Dial timeout="30">');
    expect(events.broadcastIncomingCall).toHaveBeenCalledTimes(1);
  });

  it('with hours disabled, rings whatever the time', async () => {
    // hoursEnabled is the master switch and the one-click rollback.
    jest.setSystemTime(AFTER_HOURS);
    const { controller, events } = build({
      settings: settings({ hoursEnabled: false }),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Dial');
    expect(xml).toContain('Greeting for Acme Bookkeeping.');
    expect(events.broadcastIncomingCall).toHaveBeenCalledTimes(1);
  });

  // ── Case 3: closed, hang up. THE invariant. ────────────────────────────────

  it('after hours, speaks the closed message and hangs up', async () => {
    jest.setSystemTime(AFTER_HOURS);
    const { controller } = build({});
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Closed message for Acme Bookkeeping.</Say>');
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Dial');
  });

  it('does NOT broadcast the call when it is about to be hung up', async () => {
    // The one rule a future edit would silently break, and it is invisible in the XML:
    // broadcasting here raises a ringing popup and an in-tab Answer banner for a call
    // SignalWire is already ending, and nothing clears them until the 40s TTL.
    jest.setSystemTime(AFTER_HOURS);
    const { controller, events } = build({});
    await controller.voiceInbound(signedRequest(BODY), BODY);
    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
  });

  // ── Case 4: closed, ring anyway ────────────────────────────────────────────

  it('after hours with hang-up off, speaks the message and still dials', async () => {
    jest.setSystemTime(AFTER_HOURS);
    const { controller, events } = build({
      settings: settings({ afterHoursHangUp: false }),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Closed message for Acme Bookkeeping.</Say>');
    expect(xml).toContain('<Dial');
    expect(xml).not.toContain('<Hangup/>');
    expect(events.broadcastIncomingCall).toHaveBeenCalledTimes(1);
  });

  // ── Cases 5-7: the three "nobody to ring" fallbacks ────────────────────────

  it('uses the CONFIGURED unavailable message when SIP is not configured', async () => {
    const { controller, events } = build({ sipConfigured: false });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Nobody available.</Say>');
    expect(xml).toContain('<Hangup/>');
    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
  });

  it('uses it for an unknown number, with the company placeholder rendering empty', async () => {
    const { controller, phoneSettings } = build({
      route: null,
      settings: settings({ unavailableMessage: 'Sorry[{company name}].' }),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    // No company to name, so the token renders empty rather than "undefined".
    expect(xml).toContain('<Say>Sorry[].</Say>');
    expect(phoneSettings.effectiveFor).toHaveBeenCalledWith(null);
  });

  it('uses it when the company has no assignee and no admins', async () => {
    const { controller, events } = build({
      route: { ...ROUTE, targetUserIds: [] },
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Nobody available.</Say>');
    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
  });

  it('resolves settings for the company the number belongs to', async () => {
    const { controller, phoneSettings } = build({});
    await controller.voiceInbound(signedRequest(BODY), BODY);
    expect(phoneSettings.effectiveFor).toHaveBeenCalledWith(90);
  });

  // ── Escaping and voice ─────────────────────────────────────────────────────

  it('escapes an apostrophe in the company name exactly once', async () => {
    const { controller } = build({
      route: { ...ROUTE, companyName: "O'Brien Books" },
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Greeting for O&apos;Brien Books.</Say>');
    expect(xml).not.toContain('&amp;apos;');
  });

  it('puts the configured voice on Say and never on Dial', async () => {
    const { controller } = build({ settings: settings({ voice: 'alice' }) });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say voice="alice">');
    expect(xml).not.toContain('<Dial voice');
  });

  it('omits the voice attribute when the setting is the empty string', async () => {
    // '' means "take the provider default", which is an absent attribute.
    const { controller } = build({ settings: settings({ voice: '' }) });
    expect(await controller.voiceInbound(signedRequest(BODY), BODY)).toContain(
      '<Say>',
    );
  });
});

// ── Voicemail ────────────────────────────────────────────────────────────────

function vmSettings(over: Partial<EffectivePhoneSettings> = {}) {
  return settings({
    voicemailEnabled: true,
    voicemailPrompt: 'Leave a message for {company name}.',
    voicemailMaxSeconds: 90,
    ...over,
  });
}

/** Signed for a route other than voiceUrl. */
function signedFor(url: string, body: Record<string, string>) {
  return {
    headers: { [SIGNATURE_HEADER]: computeSignature(url, body, SIGN_KEY) },
  } as unknown as Request;
}

describe('voicemail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
    process.env.PHONE_RECORD_CALLS = '0';
    jest.useFakeTimers().setSystemTime(DURING_HOURS);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });

  it('adds a <Dial action> only when voicemail is enabled', async () => {
    const off = build({});
    expect(await off.controller.voiceInbound(signedRequest(BODY), BODY)).not.toContain(
      'action=',
    );

    const on = build({ settings: vmSettings() });
    expect(await on.controller.voiceInbound(signedRequest(BODY), BODY)).toContain(
      'action="https://example.test/api/phone/voice/dial-status"',
    );
  });

  it('takes a message after hours instead of hanging up', async () => {
    jest.setSystemTime(AFTER_HOURS);
    const { controller } = build({ settings: vmSettings() });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('Closed message for Acme Bookkeeping.');
    expect(xml).toContain('Leave a message for Acme Bookkeeping.');
    expect(xml).toContain('<Record');
    expect(xml).not.toContain('<Hangup/>');
  });

  it('still hangs up after hours when voicemail is off', async () => {
    jest.setSystemTime(AFTER_HOURS);
    const { controller } = build({});
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Record');
  });

  // An unknown number has no company, so a recording could never be filed anywhere or
  // shown to anyone -- and we would be billed to store it.
  it('does not offer voicemail on an unknown number', async () => {
    const { controller } = build({ route: null, settings: vmSettings() });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Record');
  });

  // THE trap. <Dial> hands control to the action URL when nobody answered AND when the
  // agent finished a normal conversation. Getting this wrong plays "leave a message" to
  // a customer who has just spent ten minutes talking to us.
  it('hangs up rather than recording when the call was answered', async () => {
    const { controller } = build({ settings: vmSettings() });
    const body = { ...BODY, DialCallStatus: 'completed' };
    const url = webhookUrls(process.env).dialStatusUrl;

    const xml = await controller.dialStatus(signedFor(url, body), body);
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Record');
  });

  it.each(['no-answer', 'busy', 'failed'])(
    'offers voicemail when the dial ended as %s',
    async (status) => {
      const { controller } = build({ settings: vmSettings() });
      const body = { ...BODY, DialCallStatus: status };
      const url = webhookUrls(process.env).dialStatusUrl;

      const xml = await controller.dialStatus(signedFor(url, body), body);
      expect(xml).toContain('Leave a message for Acme Bookkeeping.');
      expect(xml).toContain('maxLength="90"');
    },
  );

  it('rejects an unsigned dial-status callback', async () => {
    const { controller } = build({ settings: vmSettings() });
    await expect(
      controller.dialStatus({ headers: {} } as unknown as Request, BODY),
    ).rejects.toThrow('Invalid signature');
  });

  // ── The two branches nobody had pinned ──────────────────────────────────────
  //
  // The three "nobody to ring" fallbacks above all run with voicemail OFF, so they only
  // ever pinned the hang-up shape. These are the paths the user actually hit: nothing is
  // registered to ring, and the line was dropped instead of taking a message.

  it('takes a message when no browser can be rung at all', async () => {
    const { controller, events } = build({
      sipConfigured: false,
      settings: vmSettings(),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('Nobody available.');
    expect(xml).toContain('Leave a message for Acme Bookkeeping.');
    expect(xml).toContain('<Record');
    expect(xml).not.toContain('<Hangup/>');
    // Still no ringing popup: there is no <Dial>, so there is nothing to answer.
    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
  });

  it('takes a message when the company has no assignee and no admins', async () => {
    const { controller, events } = build({
      route: { ...ROUTE, targetUserIds: [] },
      settings: vmSettings(),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Record');
    expect(xml).toContain('maxLength="90"');
    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
  });

  // The <Record> must post back to the voicemail route, or the audio is stored and the
  // timeline cache is never busted -- the message exists but shows up minutes late.
  it('points the recording at the voicemail callback', async () => {
    jest.setSystemTime(AFTER_HOURS);
    const { controller } = build({ settings: vmSettings() });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain(
      'action="https://example.test/api/phone/voice/voicemail"',
    );
  });

  // A settings read that fails must not hang up on people. HARDCODED_FALLBACK is what
  // effectiveFor returns then, and it now has voicemail on.
  it('offers voicemail on the hardcoded fallback settings', async () => {
    const { controller } = build({ settings: HARDCODED_FALLBACK });
    const body = { ...BODY, DialCallStatus: 'no-answer' };
    const url = webhookUrls(process.env).dialStatusUrl;

    const xml = await controller.dialStatus(signedFor(url, body), body);
    expect(xml).toContain('<Record');
  });

  it('busts the timeline cache when a message is left', async () => {
    const { controller, timeline } = build({ settings: vmSettings() });
    const body = { ...BODY, RecordingSid: 'rec-1', RecordingDuration: '12' };
    const url = webhookUrls(process.env).voicemailUrl;

    const xml = await controller.voicemail(signedFor(url, body), body);
    expect(xml).toContain('<Hangup/>');
    await Promise.resolve();
    expect(timeline.bust).toHaveBeenCalled();
  });
});
