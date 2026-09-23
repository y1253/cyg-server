import type { Request } from 'express';
import { PhoneWebhooksController } from './phone-webhooks.controller';
import { SIGNATURE_HEADER, computeSignature } from './signature.util';
import { webhookUrls } from './phone.config';
import type { CallRoutingService } from './call-routing.service';
import type { PhoneEventsService } from './phone-events.service';
import type { PhoneTimelineService } from './phone-timeline.service';
import type { PhoneSettingsService } from '../phone-settings/phone-settings.service';
import type { CallSummaryService } from './call-summary.service';
import type { SmsOptOutService } from './sms-opt-out.service';
import type { ContactsService } from '../contacts/contacts.service';
import type { ConferenceService } from './conference.service';
import type { PhoneAudioService } from '../phone-audio/phone-audio.service';
import type { ActiveCallsService } from './active-calls.service';
import type { RealtimeService } from '../realtime/realtime.service';
import {
  FALLBACK_WEEK,
  HARDCODED_FALLBACK,
  SEED_DEFAULTS,
  type EffectivePhoneSettings,
  type WeeklyHours,
} from '../phone-settings/phone-settings.util';

const SIGN_KEY = 'test-signing-key';
const SIP = 'testcyg@cyg-abc.sip.signalwire.com';
/**
 * The <Sip> noun as it now reaches SignalWire: the call's own sid folded into the URI as
 * `X-Cyg-Leg`, so the browser can tell TWO concurrent INVITEs apart. See `ringAndDial`.
 */
const sipNounFor = (callSid: string) => `<Sip>sip:${SIP}?X-Cyg-Leg=${callSid}</Sip>`;
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
  /** A saved contact's name for the caller, when the test is about that. */
  contactName?: string | null;
  /** This line is waiting for Meta to phone with a WhatsApp verification code. */
  voiceCodeExpected?: boolean;
  /** The conference record this leg belongs to, for the dial-status add-call branch. */
  joining?: {
    room: string;
    agentSid: string;
    rootSid: string;
    clientSid?: string;
  } | null;
  /** A configured hold track, for the conference-wait route. */
  holdTrack?: { id: number } | null;
}) {
  const routing = {
    resolve: jest
      .fn()
      .mockResolvedValue(opts.route === undefined ? ROUTE : opts.route),
  };
  const events = {
    broadcastIncomingCall: jest.fn(),
    clearRinging: jest.fn(),
    emitSms: jest.fn(),
    emitVoiceCode: jest.fn(),
    emitDialCompleted: jest.fn(),
    emitCallEnded: jest.fn(),
    // No verification code is pending in any of the cases below, which is what keeps
    // every existing LaML assertion byte-identical: the interception branch returns
    // before any of them when this answers null, and is inert when it does not.
    takeVoiceCodeExpectation: jest
      .fn()
      .mockReturnValue(opts.voiceCodeExpected ? { requestedAt: Date.now() } : null),
  };
  const timeline = {
    bust: jest.fn(),
    refreshCompanyCounts: jest.fn().mockResolvedValue(undefined),
  };
  const phoneSettings = {
    effectiveFor: jest.fn().mockResolvedValue(opts.settings ?? settings()),
  };
  const summaries = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const optOuts = {
    optOut: jest.fn().mockResolvedValue(undefined),
    optIn: jest.fn().mockResolvedValue(undefined),
    isOptedOut: jest.fn().mockResolvedValue(false),
  };

  // Default: nobody has saved this caller, which is the common case and the one every
  // pre-existing assertion in this file was written against.
  const contacts = {
    nameForNumber: jest.fn().mockResolvedValue(opts.contactName ?? null),
  };

  // Default: no conference is waiting for this leg, which is every ordinary call. The
  // add-call cases below set `joining` to exercise the branch.
  // Default: this leg belongs to no conference, which is every ordinary call. The
  // add-call cases set `joining` to exercise the branch.
  const conference = {
    joinTargetFor: jest.fn().mockReturnValue(opts.joining ?? null),
    recordForLeg: jest.fn().mockReturnValue(null),
    noteConferenceEvent: jest.fn(),
  };

  const audio = { resolve: jest.fn().mockResolvedValue(opts.holdTrack ?? null) };

  const activeCalls = {
    noteInboundRinging: jest.fn(),
    onTerminalStatus: jest.fn().mockResolvedValue(undefined),
  };
  const realtime = { publish: jest.fn() };

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
      optOuts as unknown as SmsOptOutService,
      contacts as unknown as ContactsService,
      conference as unknown as ConferenceService,
      audio as unknown as PhoneAudioService,
      activeCalls as unknown as ActiveCallsService,
      realtime as unknown as RealtimeService,
    ),
    activeCalls,
    events,
    realtime,
    routing,
    optOuts,
    contacts,
    conference,
    audio,
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

  // ── Meta's WhatsApp verification call ──────────────────────────────────────
  //
  // When a number cannot be verified by text, Meta is asked to PHONE the support number
  // and read the code aloud. That call arrives here like any other and must be recorded
  // rather than rung through to somebody who could do nothing with it.

  it('records the call instead of ringing anyone, when a code is expected', async () => {
    const { controller, events } = build({ voiceCodeExpected: true });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Record');
    expect(xml).toContain('action="https://example.test/api/phone/voice/wa-code"');
    // ⚠️ A beep is for a human. Meta's robot may start the moment the call connects, and
    // a beep over the first digits costs the whole attempt.
    expect(xml).toContain('playBeep="false"');
    // No <Dial> and no <Say>: there is nobody to ring and nothing to tell a robot.
    expect(xml).not.toContain('<Dial');
    expect(xml).not.toContain('<Say');
  });

  /**
   * ⚠️ THE reason the interception sits above every other case. `broadcastIncomingCall`
   * lives inside `ringAndDial`, so returning before it is what guarantees no ringing
   * popup, no Answer banner, and no entry in the active-call registry for a call that is
   * a robot reading six digits.
   */
  it('raises no popup and no ringing state for a verification call', async () => {
    const { controller, events, contacts, phoneSettings } = build({
      voiceCodeExpected: true,
    });
    await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
    // Nor does it pay for any of the work the ordinary path does first.
    expect(contacts.nameForNumber).not.toHaveBeenCalled();
    expect(phoneSettings.effectiveFor).not.toHaveBeenCalled();
  });

  it('is inert for an ordinary caller — the branch cannot fire without an expectation', async () => {
    const { controller, events } = build({});
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).not.toContain('<Record');
    expect(xml).toContain('<Dial');
    expect(events.broadcastIncomingCall).toHaveBeenCalledTimes(1);
  });

  // ── Case 1: open, greeting on ──────────────────────────────────────────────

  it('speaks the greeting and THEN dials, in one Response', async () => {
    const { controller, events } = build({});
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).toContain('<Say>Greeting for Acme Bookkeeping.</Say>');
    expect(xml).toContain(sipNounFor(CALL_SID));
    expect(xml.indexOf('<Say')).toBeLessThan(xml.indexOf('<Dial'));
    expect(xml.match(/<Response>/g)).toHaveLength(1);
    expect(events.broadcastIncomingCall).toHaveBeenCalledTimes(1);
  });

  // ── The caller's NAME on the ringing card ──────────────────────────────────

  it('puts a saved contact name on the event, without touching the LaML', async () => {
    const { controller, events, contacts } = build({ contactName: 'Dana Fisher' });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(contacts.nameForNumber).toHaveBeenCalledWith(
      ROUTE.companyId,
      FROM,
    );
    expect(events.broadcastIncomingCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: FROM, fromName: 'Dana Fisher' }),
    );
    // A name is for the card. It must never reach the caller's own audio.
    expect(xml).not.toContain('Dana Fisher');
  });

  it('OMITS fromName when nobody has saved the caller, rather than sending null', async () => {
    const { controller, events } = build({});
    await controller.voiceInbound(signedRequest(BODY), BODY);

    const [, event] = events.broadcastIncomingCall.mock.calls[0];
    expect(event).not.toHaveProperty('fromName');
  });

  it('never looks a contact up on a path that rings nobody', async () => {
    // No route means no company to scope the lookup to, and no card to label.
    const { controller, contacts } = build({ route: null });
    await controller.voiceInbound(signedRequest(BODY), BODY);
    expect(contacts.nameForNumber).not.toHaveBeenCalled();
  });

  it('still rings when the address book throws — a name is never worth a call', async () => {
    const { controller, events, contacts } = build({});
    // nameForNumber swallows its own failures; this pins that the webhook does not
    // depend on that promise resolving usefully.
    contacts.nameForNumber.mockResolvedValue(null);
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);
    expect(xml).toContain(sipNounFor(CALL_SID));
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
    // The <Dial> itself is no longer byte-identical to the pre-voicemail LaML: it now
    // always carries `action`, so a leg whose partner is redirected into a conference
    // has somewhere to go. What must stay true is that turning the greeting off emits
    // no <Say> rather than an empty one.
    const { controller, events } = build({
      settings: settings({ playGreeting: false }),
    });
    const xml = await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(xml).not.toContain('<Say');
    expect(xml).toContain('<Dial timeout="30"');
    expect(xml).toContain(sipNounFor(CALL_SID));
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

  /**
   * ⚠️ This assertion is the INVERSE of the one it replaces, and deliberately so.
   *
   * `action` used to be emitted only when voicemail was enabled, on the grounds that
   * with voicemail off there was nothing to fall through TO. That stopped being true
   * when add-call arrived: `voice/dial-status` is also where a leg lands when its
   * bridged partner is REDIRECTED away, which is how the root is moved into a
   * conference. With no `action` that leg runs out of document and hangs up — dropping
   * the customer at the exact moment somebody is added to the call.
   *
   * It is safe to make unconditional because dial-status already answers the
   * voicemail-off case with hangup(), which is exactly what running out of document
   * did. The two cases below pin both halves of that.
   */
  it('always emits a <Dial action>, whether or not voicemail is enabled', async () => {
    const off = build({});
    expect(
      await off.controller.voiceInbound(signedRequest(BODY), BODY),
    ).toContain('action="https://example.test/api/phone/voice/dial-status"');

    const on = build({ settings: vmSettings() });
    expect(
      await on.controller.voiceInbound(signedRequest(BODY), BODY),
    ).toContain('action="https://example.test/api/phone/voice/dial-status"');
  });

  it('still hangs up rather than recording when voicemail is off', async () => {
    // The other half of making `action` unconditional: the extra webhook must not
    // start offering voicemail to companies that have it switched off.
    const { controller } = build({});
    const body = { CallSid: CALL_SID, DialCallStatus: 'no-answer', To: TO };
    const url = webhookUrls(process.env).dialStatusUrl;
    const xml = await controller.dialStatus(signedFor(url, body), body);

    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Record');
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

/** A genuinely signed inbound-SMS request — signed against smsUrl, not voiceUrl. */
function signedSmsRequest(body: Record<string, string>) {
  const url = webhookUrls(process.env).smsUrl;
  const signature = computeSignature(url, body, SIGN_KEY);
  return { headers: { [SIGNATURE_HEADER]: signature } } as unknown as Request;
}

/**
 * The consumer keywords.
 *
 * This is a COMPLIANCE path and it is invisible in the happy path: an ordinary message
 * behaves exactly as it did before, so a regression here shows up only as a carrier
 * violation weeks later. Hence a test per keyword plus the two silent-failure cases.
 */
describe('PhoneWebhooksController.smsInbound', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  const smsBody = (text: string) => ({
    From: FROM,
    To: TO,
    Body: text,
    MessageSid: 'msg-1',
  });

  it('rejects an unsigned request', async () => {
    const { controller } = build({});
    await expect(
      controller.smsInbound({ headers: {} } as unknown as Request, smsBody('STOP')),
    ).rejects.toThrow();
  });

  it('records the opt-out and replies with the registered text on STOP', async () => {
    const { controller, optOuts } = build({});
    const xml = await controller.smsInbound(
      signedSmsRequest(smsBody('STOP')),
      smsBody('STOP'),
    );
    expect(optOuts.optOut).toHaveBeenCalledWith(FROM, 'STOP');
    expect(xml).toContain('<Message>');
    expect(xml).toContain('unsubscribed');
  });

  it('answers HELP without touching the opt-out list', async () => {
    // HELP is the one with no carrier backstop at all — nothing in the network
    // answers it, and it must be answered whether or not they are subscribed.
    const { controller, optOuts } = build({});
    const xml = await controller.smsInbound(
      signedSmsRequest(smsBody('HELP')),
      smsBody('HELP'),
    );
    expect(optOuts.optOut).not.toHaveBeenCalled();
    expect(optOuts.optIn).not.toHaveBeenCalled();
    expect(xml).toContain('office@cygfinance.com');
  });

  it('clears the opt-out on START', async () => {
    const { controller, optOuts } = build({});
    const xml = await controller.smsInbound(
      signedSmsRequest(smsBody('START')),
      smsBody('START'),
    );
    expect(optOuts.optIn).toHaveBeenCalledWith(FROM);
    expect(xml).toContain('subscribed');
  });

  it('leaves an ordinary message byte-identical to the pre-feature response', async () => {
    const { controller, optOuts } = build({});
    const body = smsBody('Here is the August statement');
    const xml = await controller.smsInbound(signedSmsRequest(body), body);
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(optOuts.optOut).not.toHaveBeenCalled();
  });

  it('still replies when the opt-out write fails', async () => {
    // The customer is owed the confirmation either way; a failed write is logged
    // loudly rather than swallowing the reply.
    const { controller, optOuts } = build({});
    optOuts.optOut.mockRejectedValueOnce(new Error('db down'));
    const body = smsBody('STOP');
    const xml = await controller.smsInbound(signedSmsRequest(body), body);
    expect(xml).toContain('unsubscribed');
  });
});

describe('dial-status: the add-call safety net', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
    process.env.PHONE_RECORD_CALLS = '1';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  const ROOM = 'cyg-root-sid';
  const dial = async (
    joining: { room: string; agentSid: string; rootSid: string } | null,
    status: string,
    extra: Record<string, string> = {},
  ) => {
    const { controller, conference, events } = build({ joining });
    const body = {
      CallSid: CALL_SID,
      DialCallStatus: status,
      To: TO,
      ...extra,
    };
    const url = webhookUrls(process.env).dialStatusUrl;
    const xml = await controller.dialStatus(signedFor(url, body), body);
    return { xml, conference, events };
  };

  /**
   * ⚠️ THE assertion for this branch. Moving a call into a conference redirects the
   * CHILD leg, which tears down the bridge and lands the ROOT here with
   * `DialCallStatus: 'completed'` — the bridge really did end normally. If the
   * `completed` hang-up ran first, the customer would be dropped at the exact moment
   * somebody was being added to their call.
   */
  it('joins the conference even when DialCallStatus is completed', async () => {
    const { xml } = await dial({ room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID }, 'completed');
    expect(xml).toContain(`<Conference`);
    expect(xml).toContain(ROOM);
    expect(xml).not.toContain('<Hangup/>');
  });

  it('re-states record on the root, or the call silently stops being recorded', async () => {
    // A redirect drops every attribute the previous <Dial> carried. This leg is the
    // root by definition, and the root is where the recording lives.
    const { xml } = await dial({ room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID }, 'completed');
    expect(xml).toContain('record="record-from-answer-dual"');
  });

  it('emits no action, so the room ending cannot re-enter this branch', async () => {
    const { xml } = await dial({ room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID }, 'completed');
    expect(xml).not.toContain('action=');
  });

  it('gives the agent the agent document when the root IS the agent leg', async () => {
    // Outbound click-to-call: the agent's own SIP leg is the root. Only the agent may
    // carry endConferenceOnExit, or hanging up would not end the call.
    const { xml } = await dial({ room: ROOM, agentSid: CALL_SID, rootSid: CALL_SID }, 'completed');
    expect(xml).toContain('endConferenceOnExit="true"');
  });

  it('gives the customer the party document when the root is the customer', async () => {
    const { xml } = await dial({ room: ROOM, agentSid: 'agent-leg', rootSid: CALL_SID }, 'completed');
    expect(xml).toContain('endConferenceOnExit="false"');
  });

  it('falls through to the ordinary hang-up when no conference is waiting', async () => {
    const { xml } = await dial(null, 'completed');
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Conference');
  });

  /**
   * ⚠️ The emit must sit BELOW the conference branch, and this is what holds it there.
   *
   * A conference join is a `<Dial>` ending because the call is being MOVED, not because
   * it is over — and `DialCallStatus` there is routinely 'completed' or ''. An emit above
   * this branch would stamp a live call as ended, and because that answer is retryable it
   * would do so repeatedly. The subscriber writes `endedAt` and a duration, so the damage
   * is a mid-call row that reads as finished.
   */
  it('emits NOTHING when the dial is really a conference join', async () => {
    const { events } = await dial(
      { room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID },
      'completed',
    );
    expect(events.emitDialCompleted).not.toHaveBeenCalled();
  });

  it('emits the outcome once for a dial that genuinely ended', async () => {
    const { events } = await dial(null, 'no-answer');
    expect(events.emitDialCompleted).toHaveBeenCalledTimes(1);
    expect(events.emitDialCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ callSid: CALL_SID, dialStatus: 'no-answer' }),
    );
  });

  /**
   * An internal staff call's `To` is a sip: URI, so it resolves to no company and the
   * handler has always answered `<Hangup/>`. The emit is how that same callback now
   * settles `InternalCall.status` — so this pins BOTH halves: the LaML is unchanged, and
   * the event goes out anyway.
   */
  it('still hangs up on an internal (sip:) dial, and still emits', async () => {
    const { xml, events } = await dial(null, 'completed', {
      To: 'sip:cyg_shared@cygfinance.sip.signalwire.com',
    });
    expect(xml).toContain('<Hangup/>');
    expect(events.emitDialCompleted).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ NULL, never 0, when SignalWire did not send a duration.
   *
   * Nothing in this repo has ever verified that `DialCallDuration` is sent at all. A 0
   * here would reach `outcomeOf`'s `durationSec > 0` test and file an answered staff call
   * as MISSED — permanently, since nothing revisits a settled row.
   */
  it('reports an absent DialCallDuration as null rather than zero', async () => {
    const { events } = await dial(null, 'busy');
    expect(events.emitDialCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: null }),
    );
  });

  it('parses DialCallDuration when it IS sent', async () => {
    const { events } = await dial(null, 'no-answer', {
      DialCallDuration: '37',
      DialCallSid: 'child-leg',
    });
    expect(events.emitDialCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 37, dialCallSid: 'child-leg' }),
    );
  });

  /**
   * ⚠️ THE regression test for the bug that dropped three live calls.
   *
   * The previous design made this lookup ONE-SHOT, so a second callback for the same leg
   * fell through to the hang-up below — and because the explicit redirect claimed the
   * flag first, the very FIRST callback already fell through. Membership is idempotent:
   * a leg in a live record is answered with its room every single time.
   *
   * Safe, because during a retry the leg is not in the room — it is waiting for this
   * answer — so re-issuing the join cannot pull anybody out.
   */
  it('answers the SAME leg twice with the room, never a hangup', async () => {
    const joining = { room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID };
    for (const attempt of [1, 2]) {
      const { xml } = await dial(joining, 'completed');
      expect(xml).toContain(ROOM);
      expect(xml).not.toContain('<Hangup/>');
      expect(attempt).toBeLessThan(3);
    }
  });

  it('joins whatever DialCallStatus says, including values we have never seen', async () => {
    // The live logs proved the real value is NOT 'completed' — and it is not logged on
    // the branch that killed the call, so we still do not know what it is. The decision
    // must not depend on it at all.
    for (const status of ['completed', '', 'answered', 'no-answer', 'busy', 'failed']) {
      const { xml } = await dial(
        { room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID },
        status,
      );
      expect(xml).toContain(ROOM);
      expect(xml).not.toContain('<Hangup/>');
      expect(xml).not.toContain('<Record');
    }
  });

  it('carries no statusCallback — this response is retryable', async () => {
    // Registered once from the child's document instead. From a retried webhook response
    // it would duplicate every join and leave event.
    const { xml } = await dial(
      { room: ROOM, agentSid: 'other-leg', rootSid: CALL_SID },
      'completed',
    );
    expect(xml).not.toContain('statusCallback');
  });

  it('asks about the conference before anything else, on every status', async () => {
    for (const status of ['completed', 'no-answer', 'busy', 'failed']) {
      const { conference } = await dial(null, status);
      expect(conference.joinTargetFor).toHaveBeenCalledWith(CALL_SID);
    }
  });
});

describe('conference-wait: what a held party hears', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
    process.env.JWT_SECRET = 'test-secret';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  const wait = async (opts: Parameters<typeof build>[0]) => {
    const { controller, conference } = build(opts);
    conference.recordForLeg.mockReturnValue({ companyId: 90, room: 'cyg-x' });
    const body = { CallSid: CALL_SID, FriendlyName: 'cyg-x' };
    const url = webhookUrls(process.env).conferenceWaitUrl;
    return controller.conferenceWait(signedFor(url, body), body);
  };

  it('plays the company track on a forever loop when one is configured', async () => {
    const xml = await wait({ holdTrack: { id: 7 } });
    // loop="0" is FOREVER in LaML, not "do not play".
    expect(xml).toContain('<Play loop="0">');
    expect(xml).toContain('/api/phone/audio/7?token=');
  });

  /**
   * ⚠️ Never an empty <Response/>. That exhausts the document, which DROPS the
   * participant out of the room — the same outcome the 404 this route replaces produced.
   * A <Pause> ends normally, SignalWire re-fetches, and the participant loops in silence.
   */
  it('falls back to a Pause, never an empty Response, with no track', async () => {
    const xml = await wait({});
    expect(xml).toContain('<Pause');
    expect(xml).not.toMatch(/<Response\s*\/>/);
  });

  it('still answers safely when the lookup throws', async () => {
    const { controller, conference } = build({});
    conference.recordForLeg.mockImplementation(() => {
      throw new Error('boom');
    });
    const body = { CallSid: CALL_SID, FriendlyName: 'cyg-x' };
    const url = webhookUrls(process.env).conferenceWaitUrl;
    const xml = await controller.conferenceWait(signedFor(url, body), body);
    expect(xml).toContain('<Pause');
  });

  it('rejects an unsigned request', async () => {
    const { controller } = build({});
    await expect(
      controller.conferenceWait({ headers: {} } as unknown as Request, {
        CallSid: CALL_SID,
      }),
    ).rejects.toThrow();
  });
});

describe('conference-status: the log that ends this bug class', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const post = (body: Record<string, string>) => {
    const { controller, conference } = build({});
    const url = webhookUrls(process.env).conferenceStatusUrl;
    return {
      xml: controller.conferenceStatusCallback(signedFor(url, body), body),
      conference,
    };
  };

  it('hands every event to the service and answers 200 with an empty Response', () => {
    const body = {
      StatusCallbackEvent: 'participant-join',
      ConferenceSid: 'conf-1',
      FriendlyName: 'cyg-root',
      CallSid: CALL_SID,
    };
    const { xml, conference } = post(body);
    expect(conference.noteConferenceEvent).toHaveBeenCalledWith(body);
    expect(xml).toContain('<Response');
  });

  it('answers 200 for a room it knows nothing about', () => {
    // A 500 here makes SignalWire retry and tells us nothing.
    expect(() =>
      post({ StatusCallbackEvent: 'conference-end', FriendlyName: 'someone-else' }),
    ).not.toThrow();
  });

  it('rejects an unsigned request', () => {
    const { controller } = build({});
    expect(() =>
      controller.conferenceStatusCallback({ headers: {} } as unknown as Request, {}),
    ).toThrow();
  });
});

describe('dial-status on a FORKED click-to-call — the callback carries the POST sid', () => {
  /**
   * ⚠️ THE regression test for the third add-call failure.
   *
   * A click-to-call to a SIP credential registered twice is forked into two root calls.
   * The API returns one sid (DEAD, the twin nobody answered); the call runs on LIVE.
   * SignalWire then posts the root's <Dial action> under DEAD — CallStatus 'initiated',
   * DialCallStatus '' on every one observed — while applying our answer to LIVE.
   *
   * The handler used to compare the raw sid, find nothing, answer <Hangup/>, and SignalWire
   * hung up the agent's live leg in the same second.
   */
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
    process.env.PHONE_RECORD_CALLS = '1';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const DEAD = 'dead-post-sid';
  const LIVE = 'live-fork-sid';
  const ROOM = `cyg-${LIVE}`;
  const forked = { room: ROOM, agentSid: LIVE, rootSid: LIVE, clientSid: DEAD };

  const callback = async (callSid: string, dialStatus: string) => {
    const { controller } = build({ joining: forked });
    const body = {
      CallSid: callSid,
      DialCallStatus: dialStatus,
      CallStatus: 'initiated',
      To: 'sip:testcyg@cygfinance.sip.signalwire.com',
      From: 'sip:+14382563856@sip.signalwire.com',
    };
    const url = webhookUrls(process.env).dialStatusUrl;
    return controller.dialStatus(signedFor(url, body), body);
  };

  it('answers the POST-sid callback with the AGENT document, never a hangup', async () => {
    for (const status of ['', 'completed']) {
      const xml = await callback(DEAD, status);
      expect(xml).toContain(ROOM);
      expect(xml).not.toContain('<Hangup/>');
      // The agent, so hanging up still ends the call for everybody...
      expect(xml).toContain('endConferenceOnExit="true"');
      // ...and the root, so the conversation keeps being recorded.
      expect(xml).toContain('record="record-from-answer-dual"');
    }
  });

  it('gives the same document when the callback names the live fork directly', async () => {
    expect(await callback(LIVE, '')).toBe(await callback(DEAD, ''));
  });

  it('hands SignalWire no wait URL — it could only ever mean silence', async () => {
    const xml = await callback(DEAD, '');
    expect(xml).not.toContain('waitUrl');
  });
});

describe('busy line: which webhooks mark a company busy, and free it', () => {
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

  it('records a ringing inbound call on the same path that broadcasts it', async () => {
    const { controller, activeCalls, events } = build({ contactName: 'Dana Cohen' });
    await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(events.broadcastIncomingCall).toHaveBeenCalled();
    expect(activeCalls.noteInboundRinging).toHaveBeenCalledWith({
      companyId: ROUTE.companyId,
      supportNumber: TO,
      callSid: CALL_SID,
      from: FROM,
      fromName: 'Dana Cohen',
    });
  });

  it('records nothing on the after-hours hang-up path, which rings nobody', async () => {
    jest.setSystemTime(AFTER_HOURS);
    const { controller, activeCalls, events } = build({
      settings: settings({ afterHoursHangUp: true }),
    });
    await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(events.broadcastIncomingCall).not.toHaveBeenCalled();
    expect(activeCalls.noteInboundRinging).not.toHaveBeenCalled();
  });

  it('asks the registry to re-check the line when a call ends', () => {
    const { controller, activeCalls } = build({});
    const body = {
      CallSid: CALL_SID,
      CallStatus: 'completed',
      To: `sip:${SIP}`,
      From: TO,
    };
    controller.voiceStatus(
      signedFor(webhookUrls(process.env).statusCallback, body),
      body,
    );
    expect(activeCalls.onTerminalStatus).toHaveBeenCalledWith(CALL_SID, `sip:${SIP}`, TO);
  });

  it('leaves the line alone on a status that is not terminal', () => {
    const { controller, activeCalls } = build({});
    const body = { CallSid: CALL_SID, CallStatus: 'in-progress', To: TO, From: FROM };
    controller.voiceStatus(
      signedFor(webhookUrls(process.env).statusCallback, body),
      body,
    );
    expect(activeCalls.onTerminalStatus).not.toHaveBeenCalled();
  });
});

/**
 * What the real-time channel is TOLD, which is a different question from what got busted.
 *
 * Both of these are invisible in the LaML and in every existing assertion, and both were
 * missing before the channel existed — an inbound text reached the timeline and nothing
 * else, so it stayed outside the bell and the dashboard badge for the unread feed's 55s
 * cache plus the client's 60s poll.
 */
describe('PhoneWebhooksController — what reaches the real-time channel', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('publishes `sms` — NOT the default `phone` — for an inbound text', async () => {
    // The topic is the whole fix: `UnreadFeedService` subscribes to `sms` to drop its
    // own cache, and `phone` would busts the timeline window and nothing else.
    const { controller, realtime } = build({});

    await controller.smsInbound(
      signedSmsRequest({ From: FROM, To: TO, Body: 'hello', MessageSid: 'm1' }),
      { From: FROM, To: TO, Body: 'hello', MessageSid: 'm1' },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(realtime.publish).toHaveBeenCalledWith('sms', { companyId: 90 });
  });

  it('publishes the ringing CallEvent to the routed users only', async () => {
    const { controller, realtime } = build({});

    await controller.voiceInbound(signedRequest(BODY), BODY);

    const ringing = realtime.publish.mock.calls.find(([t]) => t === 'ringing');
    expect(ringing).toBeDefined();
    const [, opts] = ringing as [string, { userIds: number[]; payload: unknown }];
    // The audience is the one `broadcastIncomingCall` was just handed — this channel
    // must never widen who learns a company is being called.
    expect(opts.userIds).toEqual(ROUTE.targetUserIds);
    expect(opts.payload).toMatchObject({
      type: 'incoming-call',
      callSid: expect.any(String),
    });
  });

  it('does NOT announce a ring on a path whose LaML has no <Dial>', async () => {
    // Same invariant `broadcastIncomingCall` carries: announcing a call SignalWire is
    // already hanging up raises a popup nothing ever clears.
    const { controller, realtime } = build({ sipConfigured: false });

    await controller.voiceInbound(signedRequest(BODY), BODY);

    expect(realtime.publish).not.toHaveBeenCalledWith(
      'ringing',
      expect.anything(),
    );
  });
});

/**
 * The two-stage announcement on a finished call.
 *
 * The row and the badges are fresh at different moments, and collapsing them into one
 * publish gets the user's actual complaint wrong: `refreshCompanyCounts` re-reads through
 * the provider, so a client woken before it lands refetches the PRE-CALL missed count and
 * re-pins it for another cache cycle.
 */
describe('voice/status — row first, badges once they are recounted', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.SIGNALWIRE_SIGN_KEY = SIGN_KEY;
    process.env.PHONE_WEBHOOK_BASE_URL = 'https://example.test';
    process.env.PHONE_RECORD_CALLS = '0';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  const endedBody = {
    CallSid: CALL_SID,
    CallStatus: 'completed',
    To: TO,
    From: FROM,
  };

  it('announces the row immediately and the badges only after the recount', async () => {
    let settleRecount: () => void = () => undefined;
    const { controller, realtime, timeline } = build({});
    timeline.refreshCompanyCounts.mockReturnValue(
      new Promise<void>((resolve) => {
        settleRecount = resolve;
      }),
    );

    controller.voiceStatus(
      signedFor(webhookUrls(process.env).statusCallback, endedBody),
      endedBody,
    );
    // Let `companyFor` and the synchronous busts run, but not the recount.
    await new Promise((r) => setTimeout(r, 0));

    const topics = () => realtime.publish.mock.calls.map(([t]) => t);
    expect(topics()).toContain('phone');
    expect(topics()).not.toContain('call-ended');

    settleRecount();
    await new Promise((r) => setTimeout(r, 0));

    expect(realtime.publish).toHaveBeenCalledWith('call-ended', {
      companyId: ROUTE.companyId,
    });
  });

  it('still announces the badges when the recount FAILS', async () => {
    // The window is busted either way, so a refetch still beats the cached answer —
    // `finally`, not `then`.
    const { controller, realtime, timeline } = build({});
    timeline.refreshCompanyCounts.mockRejectedValue(new Error('provider down'));

    controller.voiceStatus(
      signedFor(webhookUrls(process.env).statusCallback, endedBody),
      endedBody,
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(realtime.publish).toHaveBeenCalledWith('call-ended', {
      companyId: ROUTE.companyId,
    });
  });

  it('announces NOTHING for a call that resolves to no company', async () => {
    // An internal staff call. Its two participants are told by
    // `InternalCallsService.writeOutcome`; waking the whole firm from here would have
    // every user refetch a list only those two rows changed in.
    const { controller, realtime } = build({ route: null });

    controller.voiceStatus(
      signedFor(webhookUrls(process.env).statusCallback, endedBody),
      endedBody,
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(realtime.publish).not.toHaveBeenCalled();
  });
});
