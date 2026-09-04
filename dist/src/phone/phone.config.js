"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRegions = parseRegions;
exports.regionsFor = regionsFor;
exports.webhookBase = webhookBase;
exports.webhookUrls = webhookUrls;
exports.maxPurchasesPerDay = maxPurchasesPerDay;
exports.sipCredentials = sipCredentials;
exports.sipDialTarget = sipDialTarget;
exports.recordMode = recordMode;
exports.summarizeCalls = summarizeCalls;
exports.transcribeModel = transcribeModel;
exports.summaryModel = summaryModel;
const FALLBACK_REGIONS = {
    CA: ['QC', 'ON', 'BC', 'AB'],
    US: [],
};
function parseRegions(csv) {
    return (csv ?? '')
        .split(',')
        .map((r) => r.trim().toUpperCase())
        .filter((r) => /^[A-Z]{2}$/.test(r));
}
function regionsFor(country, env) {
    const override = parseRegions(env[country === 'CA' ? 'PHONE_DEFAULT_REGIONS_CA' : 'PHONE_DEFAULT_REGIONS_US']);
    return override.length > 0 ? override : FALLBACK_REGIONS[country];
}
function webhookBase(env) {
    const first = [env.PHONE_WEBHOOK_BASE_URL, env.CALLBACK_BASE_URL].find((value) => (value ?? '').trim() !== '');
    return (first ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
}
function webhookUrls(env) {
    const base = webhookBase(env);
    return {
        voiceUrl: `${base}/api/phone/voice/inbound`,
        smsUrl: `${base}/api/phone/sms/inbound`,
        statusCallback: `${base}/api/phone/voice/status`,
        dialStatusUrl: `${base}/api/phone/voice/dial-status`,
        voicemailUrl: `${base}/api/phone/voice/voicemail`,
    };
}
function maxPurchasesPerDay(env) {
    const raw = parseInt(env.PHONE_MAX_PURCHASES_PER_DAY ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}
function sipCredentials(env) {
    const domain = env.SIGNALWIRE_SIP_DOMAIN?.trim();
    const username = env.SIGNALWIRE_SIP_USERNAME?.trim();
    const password = env.SIGNALWIRE_SIP_PASSWORD;
    if (!domain || !username || !password)
        return null;
    return { domain, username, password, wsServer: `wss://${domain}` };
}
function sipDialTarget(env) {
    const creds = sipCredentials(env);
    return creds ? `${creds.username}@${creds.domain}` : null;
}
function recordMode(env) {
    return env.PHONE_RECORD_CALLS === '0' ? undefined : 'record-from-answer-dual';
}
function summarizeCalls(env) {
    return env.PHONE_SUMMARIZE_CALLS === '1';
}
function transcribeModel(env) {
    const raw = (env.OPENAI_TRANSCRIBE_MODEL ?? '').trim();
    return raw !== '' ? raw : 'whisper-1';
}
function summaryModel(env) {
    for (const candidate of [env.OPENAI_SUMMARY_MODEL, env.OPENAI_POLISH_MODEL]) {
        const raw = (candidate ?? '').trim();
        if (raw !== '')
            return raw;
    }
    return 'gpt-4o-mini';
}
//# sourceMappingURL=phone.config.js.map