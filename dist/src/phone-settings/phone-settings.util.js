"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HARDCODED_FALLBACK = exports.SEED_DEFAULTS = exports.FALLBACK_WEEK = exports.SETTINGS_FIELDS = exports.SETTINGS_SINGLETON = void 0;
exports.parseTime = parseTime;
exports.parseWeeklyHours = parseWeeklyHours;
exports.resolveSettings = resolveSettings;
exports.SETTINGS_SINGLETON = 'GLOBAL';
exports.SETTINGS_FIELDS = [
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
];
exports.FALLBACK_WEEK = [
    null,
    { open: '09:00', close: '17:00' },
    { open: '09:00', close: '17:00' },
    { open: '09:00', close: '17:00' },
    { open: '09:00', close: '17:00' },
    { open: '09:00', close: '17:00' },
    null,
];
exports.SEED_DEFAULTS = {
    timezone: 'America/Toronto',
    weeklyHours: exports.FALLBACK_WEEK,
    greetingMessage: "You've reached the billing department of {company name}, managed by Cyg Finance. " +
        'Please hold while we connect your call.',
    afterHoursMessage: "You've reached the billing department of {company name}, managed by Cyg Finance. " +
        'Our office is currently closed. Please call back during our business hours, ' +
        'or send us an email and we will get back to you shortly.',
    unavailableMessage: 'Thank you for calling. Nobody is available to take your call right now. ' +
        'Please leave us an email and we will get back to you shortly.',
    playGreeting: true,
    afterHoursHangUp: true,
    hoursEnabled: false,
    ringTimeoutSeconds: 30,
    voice: '',
    holdAudioId: 0,
    voicemailEnabled: false,
    voicemailPrompt: 'Please leave a message after the tone, and we will get back to you as soon as we can.',
    voicemailMaxSeconds: 120,
};
exports.HARDCODED_FALLBACK = exports.SEED_DEFAULTS;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function parseTime(value) {
    if (typeof value !== 'string')
        return null;
    const m = TIME_RE.exec(value);
    if (!m)
        return null;
    return Number(m[1]) * 60 + Number(m[2]);
}
function parseWeeklyHours(raw) {
    if (!Array.isArray(raw) || raw.length !== 7)
        return null;
    const week = [];
    for (const entry of raw) {
        if (entry === null || entry === undefined) {
            week.push(null);
            continue;
        }
        if (typeof entry !== 'object' || Array.isArray(entry))
            return null;
        const { open, close } = entry;
        if (parseTime(open) === null || parseTime(close) === null)
            return null;
        week.push({ open: open, close: close });
    }
    return week;
}
function resolveSettings(global, company) {
    const base = global
        ? { ...global }
        : { ...exports.HARDCODED_FALLBACK };
    const effective = {};
    const source = {};
    for (const key of exports.SETTINGS_FIELDS) {
        if (key === 'weeklyHours')
            continue;
        const override = company?.[key] ?? null;
        effective[key] = override ?? base[key];
        source[key] = override === null ? 'default' : 'company';
    }
    const companyWeek = parseWeeklyHours(company?.weeklyHours);
    if (companyWeek) {
        effective.weeklyHours = companyWeek;
        source.weeklyHours = 'company';
    }
    else {
        effective.weeklyHours =
            parseWeeklyHours(global?.weeklyHours) ?? exports.FALLBACK_WEEK;
        source.weeklyHours = 'default';
    }
    return { effective, source };
}
//# sourceMappingURL=phone-settings.util.js.map