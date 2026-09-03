/**
 * Resolution of phone settings: global defaults, per-company overrides, and the rule that
 * decides which wins.
 *
 * Pure — no framework, no network, no Prisma — for the same reason `laml.util.ts`,
 * `signalwire-parse.ts` and `compute-next-due.ts` are: this is the logic worth testing
 * exhaustively, and it runs inside a webhook where a throw becomes "this call cannot be
 * completed" with nothing in the log to explain it.
 *
 * ── THE OVERRIDE RULE, ONCE ─────────────────────────────────────────────────────
 * On `CompanyPhoneSettings` every column is nullable and **NULL is the only absence**.
 * `''`, `false` and `0` are VALUES an admin deliberately chose. So resolution is
 * `company[k] ?? global[k]` and **never** `company[k] || global[k]` — under `||` a
 * `playGreeting: false` override silently reverts to the global `true`, a
 * `ringTimeoutSeconds: 0` becomes 30, and `voice: ''` ("provider default") becomes
 * whatever the global voice is. That single character is the most likely bug in this
 * feature, which is why `resolveSettings` is one loop over one field list rather than ten
 * hand-written lines.
 */

/**
 * One day's opening window. Times are `"HH:mm"`, 24-hour, zero-padded.
 *
 * A `type` alias rather than an `interface` on purpose: TypeScript gives a type alias an
 * implicit index signature and a declared interface none, and Prisma's `InputJsonValue`
 * requires one. As an interface this is not assignable to a `Json` column however correct
 * it is at runtime, and every write site needs an unexplained `as unknown as` cast.
 */
export type DayHours = {
  open: string;
  close: string;
};

/**
 * The week, indexed **0 = Sunday … 6 = Saturday**.
 *
 * That index base is not arbitrary: it matches `TaskSchedule.cycleDay` (documented in
 * CLAUDE.md) and `WEEKDAYS` in `client/src/lib/cycle.ts`, so a weekday index means the
 * same thing everywhere in the product. `null` means closed all day.
 */
export type WeeklyHours = (DayHours | null)[];

/** Fully resolved settings. Every field is present — this is what the webhook acts on. */
export interface EffectivePhoneSettings {
  timezone: string;
  weeklyHours: WeeklyHours;
  greetingMessage: string;
  afterHoursMessage: string;
  unavailableMessage: string;
  playGreeting: boolean;
  afterHoursHangUp: boolean;
  hoursEnabled: boolean;
  ringTimeoutSeconds: number;
  voice: string;
  /**
   * PhoneAudio.id of the hold music, or 0 for none.
   *
   * 0 rather than null because on the per-company table null already means "inherit",
   * so it cannot also mean "none". audioIdOrNone() in phone-audio.util.ts is the one
   * place that sentinel is interpreted.
   */
  holdAudioId: number;
  voicemailEnabled: boolean;
  voicemailPrompt: string;
  voicemailMaxSeconds: number;
}

/** Which side each resolved field came from. Powers the UI's "Use default" checkboxes. */
export type SettingsSource = Record<
  keyof EffectivePhoneSettings,
  'company' | 'default'
>;

/** The per-company row as stored: the same fields, each nullable, NULL = inherit. */
export type PhoneSettingsOverrides = {
  [K in keyof EffectivePhoneSettings]: EffectivePhoneSettings[K] | null;
};

/** The value of `PhoneSettingsDefault.singleton`. There is exactly one legal value. */
export const SETTINGS_SINGLETON = 'GLOBAL';

/**
 * THE field list. Both `resolveSettings` and the DTO→Prisma mapper in the service walk
 * this, so a field cannot be added to one and forgotten in the other — which is exactly
 * how an override silently stops being saved.
 */
export const SETTINGS_FIELDS = [
  'timezone',
  'weeklyHours',
  'greetingMessage',
  'afterHoursMessage',
  'unavailableMessage',
  'playGreeting',
  'afterHoursHangUp',
  'hoursEnabled',
  'ringTimeoutSeconds',
  'voice',
  'holdAudioId',
  'voicemailEnabled',
  'voicemailPrompt',
  'voicemailMaxSeconds',
] as const satisfies readonly (keyof EffectivePhoneSettings)[];

/** Mon–Fri 09:00–17:00. Used when even the global row's week is unreadable. */
export const FALLBACK_WEEK: WeeklyHours = [
  null,
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  null,
];

/**
 * What a fresh database gets. Imported by BOTH `prisma/seed.ts` and the service's
 * self-healing upsert, so there is exactly one definition of "the defaults".
 *
 * `unavailableMessage` is the previous hardcoded `HOLDING_MESSAGE` text **verbatim**, and
 * `hoursEnabled` is false, so deploying this feature changes nothing a caller can hear
 * until an admin turns it on.
 */
export const SEED_DEFAULTS: EffectivePhoneSettings = {
  timezone: 'America/Toronto',
  weeklyHours: FALLBACK_WEEK,
  greetingMessage:
    "You've reached the billing department of {company name}, managed by Cyg Finance. " +
    'Please hold while we connect your call.',
  afterHoursMessage:
    "You've reached the billing department of {company name}, managed by Cyg Finance. " +
    'Our office is currently closed. Please call back during our business hours, ' +
    'or send us an email and we will get back to you shortly.',
  unavailableMessage:
    'Thank you for calling. Nobody is available to take your call right now. ' +
    'Please leave us an email and we will get back to you shortly.',
  playGreeting: true,
  afterHoursHangUp: true,
  hoursEnabled: false,
  ringTimeoutSeconds: 30,
  voice: '',
  // No hold music until an admin uploads a track -- there is nothing to play, so 0 is
  // the only honest value.
  holdAudioId: 0,
  // Voicemail is ON. It shipped inert, on the same rule hoursEnabled follows, but that
  // rule assumes a switch an admin can find: this one had no UI, so "inert" meant every
  // after-hours caller got hung up on with no way to change it.
  voicemailEnabled: true,
  voicemailPrompt:
    'Please leave a message after the tone, and we will get back to you as soon as we can.',
  voicemailMaxSeconds: 120,
};

/**
 * The answer when the database cannot be read at all.
 *
 * `effectiveFor` never throws, and this is what it returns instead. Same reasoning as the
 * old module-level `HOLDING_MESSAGE` constant: a settings outage must not become a dead
 * phone line. `hoursEnabled: false` means a fallback always rings rather than silently
 * treating every caller as after-hours.
 *
 * By the same argument `voicemailEnabled` is true here: if the ring goes unanswered while
 * the settings table is unreadable, the caller gets to leave a message instead of being
 * cut off. Note this makes the fallback GENEROUS in both directions -- it rings, and it
 * takes a message. Neither can hang up on somebody because a database read failed.
 */
export const HARDCODED_FALLBACK: EffectivePhoneSettings = SEED_DEFAULTS;

/** `"HH:mm"`, 24-hour, zero-padded. Anything else is not a time. */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight, or null if the value is not a valid `"HH:mm"` string. */
export function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = TIME_RE.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Validate a stored or incoming week. **Never throws** — returns null on anything unusable.
 *
 * Times stay strings rather than minutes-since-midnight because they are read by humans in
 * Prisma Studio and go straight into an `<input type="time">`; the numeric form is derived
 * where it is needed.
 *
 * The write-side validator calls this too, so the shape the API accepts and the shape the
 * resolver understands cannot drift apart.
 */
export function parseWeeklyHours(raw: unknown): WeeklyHours | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null;
  const week: WeeklyHours = [];
  for (const entry of raw) {
    if (entry === null || entry === undefined) {
      week.push(null);
      continue;
    }
    if (typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { open, close } = entry as { open?: unknown; close?: unknown };
    if (parseTime(open) === null || parseTime(close) === null) return null;
    week.push({ open: open as string, close: close as string });
  }
  return week;
}

/** The global row as Prisma returns it, with `weeklyHours` still an opaque JSON value. */
export type RawDefaults = Omit<EffectivePhoneSettings, 'weeklyHours'> & {
  weeklyHours: unknown;
};

/** The company row as Prisma returns it: every field nullable, `weeklyHours` opaque. */
export type RawOverrides = {
  [K in keyof EffectivePhoneSettings]?: K extends 'weeklyHours'
    ? unknown
    : EffectivePhoneSettings[K] | null;
};

/**
 * Global + company → the settings the webhook acts on, plus where each field came from.
 *
 * `weeklyHours` gets a three-step cascade because it is the one field that can be
 * structurally invalid rather than merely absent: the company week parses → use it; else
 * the global week parses → use it (and report the source as `default`, which is the
 * truth); else `FALLBACK_WEEK`. Bad JSON in one company's row must not take out the
 * account.
 */
export function resolveSettings(
  global: RawDefaults | null,
  company: RawOverrides | null,
): { effective: EffectivePhoneSettings; source: SettingsSource } {
  const base: EffectivePhoneSettings = global
    ? ({ ...global } as unknown as EffectivePhoneSettings)
    : { ...HARDCODED_FALLBACK };

  const effective = {} as EffectivePhoneSettings;
  const source = {} as SettingsSource;

  for (const key of SETTINGS_FIELDS) {
    if (key === 'weeklyHours') continue;
    const override = company?.[key] ?? null;
    // `??`, not `||`. See the module header.
    (effective[key] as unknown) = override ?? base[key];
    source[key] = override === null ? 'default' : 'company';
  }

  const companyWeek = parseWeeklyHours(company?.weeklyHours);
  if (companyWeek) {
    effective.weeklyHours = companyWeek;
    source.weeklyHours = 'company';
  } else {
    effective.weeklyHours =
      parseWeeklyHours(global?.weeklyHours) ?? FALLBACK_WEEK;
    source.weeklyHours = 'default';
  }

  return { effective, source };
}
