"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_TRANSCRIPT_CHARS = exports.MAX_ATTEMPTS = exports.TRANSCRIBE_MP3_ARGS = exports.MAX_UPLOAD_BYTES = exports.RECORDING_GRACE_MS = exports.SUMMARY_STATUS = void 0;
exports.retryDelayMs = retryDelayMs;
exports.claimableBefore = claimableBefore;
exports.isTranscriptUsable = isTranscriptUsable;
exports.summaryLookupSids = summaryLookupSids;
exports.toSummaryView = toSummaryView;
exports.SUMMARY_STATUS = {
    pending: 'PENDING',
    ready: 'READY',
    skipped: 'SKIPPED',
    failed: 'FAILED',
};
exports.RECORDING_GRACE_MS = 10 * 60_000;
exports.MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
exports.TRANSCRIBE_MP3_ARGS = [
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '9',
    '-f',
    'mp3',
];
exports.MAX_ATTEMPTS = 4;
function retryDelayMs(attempts) {
    const ladder = [60_000, 5 * 60_000, 30 * 60_000];
    return ladder[Math.min(attempts, ladder.length - 1)];
}
function claimableBefore(now, attempts) {
    return new Date(now - retryDelayMs(attempts));
}
exports.MIN_TRANSCRIPT_CHARS = 20;
function isTranscriptUsable(transcript) {
    return transcript.trim().length >= exports.MIN_TRANSCRIPT_CHARS;
}
function summaryLookupSids(sid, parentCallSid) {
    return parentCallSid && parentCallSid !== sid ? [sid, parentCallSid] : [sid];
}
function toSummaryView(row) {
    const generatedAt = row.completedAt ? row.completedAt.toISOString() : null;
    switch (row.status) {
        case exports.SUMMARY_STATUS.ready:
            return {
                status: 'ready',
                summary: row.summary,
                reason: null,
                generatedAt,
            };
        case exports.SUMMARY_STATUS.skipped:
            return {
                status: 'skipped',
                summary: null,
                reason: 'There was nothing to summarise on this recording.',
                generatedAt,
            };
        case exports.SUMMARY_STATUS.failed:
            return {
                status: 'failed',
                summary: null,
                reason: 'The summary could not be generated.',
                generatedAt,
            };
        default:
            return {
                status: 'pending',
                summary: null,
                reason: null,
                generatedAt: null,
            };
    }
}
//# sourceMappingURL=call-summary.util.js.map