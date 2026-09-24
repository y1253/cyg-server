"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiAssist = aiAssist;
exports.aiTranscribeInbound = aiTranscribeInbound;
exports.visionModel = visionModel;
exports.summaryOrPolishModel = summaryOrPolishModel;
exports.dictationModel = dictationModel;
exports.aiDictationLive = aiDictationLive;
function aiAssist(env) {
    return (env.AI_ASSIST ?? '').trim() === '1';
}
function aiTranscribeInbound(env) {
    return (env.AI_TRANSCRIBE_INBOUND ?? '').trim() === '1';
}
function visionModel(env) {
    for (const candidate of [
        env.OPENAI_VISION_MODEL,
        env.OPENAI_SUMMARY_MODEL,
        env.OPENAI_POLISH_MODEL,
    ]) {
        const raw = (candidate ?? '').trim();
        if (raw !== '')
            return raw;
    }
    return 'gpt-4o-mini';
}
function summaryOrPolishModel(env) {
    for (const candidate of [env.OPENAI_SUMMARY_MODEL, env.OPENAI_POLISH_MODEL]) {
        const raw = (candidate ?? '').trim();
        if (raw !== '')
            return raw;
    }
    return 'gpt-4o-mini';
}
function dictationModel(env) {
    for (const candidate of [
        env.OPENAI_DICTATION_MODEL,
        env.OPENAI_TRANSCRIBE_MODEL,
    ]) {
        const raw = (candidate ?? '').trim();
        if (raw !== '')
            return raw;
    }
    return 'gpt-4o-mini-transcribe';
}
function aiDictationLive(env) {
    return (env.AI_DICTATION_LIVE ?? '').trim() === '1';
}
//# sourceMappingURL=ai.config.js.map