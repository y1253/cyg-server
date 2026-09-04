/**
 * The pure rules behind AI call summaries — no IO, so they are cheap to test.
 *
 * The service beside this does the SignalWire and OpenAI round-trips; everything here
 * is a decision that can be made from values alone.
 */

/** The four states a `CallSummary` row moves through. */
export const SUMMARY_STATUS = {
  pending: 'PENDING',
  ready: 'READY',
  /** Terminal, and NOT a failure: there was nothing worth summarising. */
  skipped: 'SKIPPED',
  /** Terminal after the retry budget is spent. */
  failed: 'FAILED',
} as const;

export type SummaryStatus =
  (typeof SUMMARY_STATUS)[keyof typeof SUMMARY_STATUS];

/**
 * How long a PENDING row waits for its audio before giving up.
 *
 * SignalWire finalises a recording some seconds after the call ends, so "no recording
 * yet" immediately after the status webhook is the NORMAL case, not a missing one. Only
 * past this window does an absent recording mean the call genuinely had none — a
 * misdial, an unanswered ring with voicemail off, or recording switched off entirely.
 */
export const RECORDING_GRACE_MS = 10 * 60_000;

/**
 * OpenAI rejects an audio upload over 25 MB. The margin is for the multipart envelope,
 * which is small but not nothing, and for a provider that measures slightly differently
 * than we do.
 */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

/**
 * ffmpeg args for the shrink pass, mirroring `TELEPHONY_MP3_ARGS` in phone-audio.
 *
 * 16 kHz because that is the rate speech models resample to internally, so anything
 * above it is bytes spent on information the model discards. `-q:a 9` is the lowest
 * useful VBR rung: intelligibility survives it, and this only runs when the file would
 * otherwise be REJECTED outright, so the trade is against no transcript at all.
 *
 * A separate constant rather than reusing `TELEPHONY_MP3_ARGS`: those flags are
 * load-bearing for the hold-music player and retuning them for a different consumer is
 * exactly how a shared constant silently breaks its first caller.
 */
export const TRANSCRIBE_MP3_ARGS = [
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

/** Attempts before a row is abandoned as FAILED. */
export const MAX_ATTEMPTS = 4;

/**
 * How long to wait before retrying, by attempts already made.
 *
 * Rising, because the failures worth retrying are transient (a rate limit, a blip) and
 * the ones that are not should stop consuming the sweep's batch slots quickly.
 */
export function retryDelayMs(attempts: number): number {
  const ladder = [60_000, 5 * 60_000, 30 * 60_000];
  return ladder[Math.min(attempts, ladder.length - 1)];
}

/** The earliest `updatedAt` a row may have and still be claimable this tick. */
export function claimableBefore(now: number, attempts: number): Date {
  return new Date(now - retryDelayMs(attempts));
}

/**
 * A transcript this short is not worth a summarisation round-trip.
 *
 * Whisper returns a bare `""` for silence, and a stray syllable or two for a recording
 * that is just line noise. Summarising either produces a confident sentence about
 * nothing, which is worse than showing no summary — so this is a SKIPPED, not a retry.
 */
export const MIN_TRANSCRIPT_CHARS = 20;

export function isTranscriptUsable(transcript: string): boolean {
  return transcript.trim().length >= MIN_TRANSCRIPT_CHARS;
}

/**
 * Which sids might carry this call's summary row.
 *
 * The row is keyed by the sid the STATUS WEBHOOK reported — the leg the `<Dial>` ran on.
 * For an inbound call that is the same leg the inbox shows. For click-to-call it is the
 * `outbound-api` SIP parent, while the inbox row is its `outbound-dial` CHILD. Looking up
 * by the displayed sid alone therefore finds nothing on every outbound call — the exact
 * shape of the bug that once made `hasRecording` false for all of them.
 */
export function summaryLookupSids(
  sid: string,
  parentCallSid?: string | null,
): string[] {
  return parentCallSid && parentCallSid !== sid ? [sid, parentCallSid] : [sid];
}

/** What the client is told, never the raw provider error. */
export interface CallSummaryView {
  status: 'pending' | 'ready' | 'skipped' | 'failed';
  summary: string | null;
  /** A short human reason when there is no summary, or null. */
  reason: string | null;
  generatedAt: string | null;
}

/**
 * Project a stored row for the client.
 *
 * `lastError` is deliberately NOT mapped through: it can carry provider detail and, on a
 * bad day, a fragment of a request. The client gets a fixed sentence per state instead.
 */
export function toSummaryView(row: {
  status: string;
  summary: string | null;
  completedAt: Date | null;
}): CallSummaryView {
  const generatedAt = row.completedAt ? row.completedAt.toISOString() : null;

  switch (row.status) {
    case SUMMARY_STATUS.ready:
      return {
        status: 'ready',
        summary: row.summary,
        reason: null,
        generatedAt,
      };
    case SUMMARY_STATUS.skipped:
      return {
        status: 'skipped',
        summary: null,
        reason: 'There was nothing to summarise on this recording.',
        generatedAt,
      };
    case SUMMARY_STATUS.failed:
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
