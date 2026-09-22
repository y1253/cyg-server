"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiAssist = aiAssist;
exports.aiTranscribeInbound = aiTranscribeInbound;
exports.visionModel = visionModel;
exports.summaryOrPolishModel = summaryOrPolishModel;
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
//# sourceMappingURL=ai.config.js.map