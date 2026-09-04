import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import { SignalWireService } from './signalwire.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { runFfmpegDetailed } from '../communications/attachment-stream.util.js';
import { summarizeCalls, summaryModel } from './phone.config.js';
import {
  claimableBefore,
  isTranscriptUsable,
  MAX_ATTEMPTS,
  MAX_UPLOAD_BYTES,
  RECORDING_GRACE_MS,
  SUMMARY_STATUS,
  summaryLookupSids,
  toSummaryView,
  TRANSCRIBE_MP3_ARGS,
  type CallSummaryView,
} from './call-summary.util.js';

/**
 * AI summaries of recorded calls.
 *
 * ── THE SHAPE, AND WHY ─────────────────────────────────────────────────────────
 * The status webhook cannot do this work inline: it must answer SignalWire fast, and the
 * recording is not even available yet when a call ends. So `enqueue` writes a PENDING
 * row and returns, and the cron below does the work.
 *
 * The ROW is the queue. There is no job runner in this codebase and the established
 * "slow work later" pattern is in-process `void ... .catch()`, which loses everything on
 * a restart — unacceptable for work that has already been paid for once. A PENDING row
 * is picked up by the next tick whatever happened in between.
 *
 * Everything here is gated on `PHONE_SUMMARIZE_CALLS=1`. It ships OFF: this bills per
 * minute of audio AND sends a client's recorded conversation to OpenAI.
 */
@Injectable()
export class CallSummaryService {
  private readonly logger = new Logger(CallSummaryService.name);

  /** How many rows one tick will touch. Bounds both spend and tick duration. */
  private static readonly BATCH = 5;
  /** Rows processed at once. Small: each one uploads audio and waits on a model. */
  private static readonly CONCURRENCY = 2;

  /**
   * Guards against a slow sweep overlapping the next tick.
   *
   * A single transcription can take minutes, so a per-minute cron WILL re-enter without
   * this — and two ticks claiming the same rows means paying OpenAI twice for one call.
   */
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
    private readonly timeline: PhoneTimelineService,
    private readonly ai: AiService,
  ) {}

  /**
   * Record that a finished call may be worth summarising.
   *
   * Called from the status webhook for every terminal call, and from the voicemail
   * webhook, which is the one place a `RecordingSid` is handed to us directly.
   *
   * NEVER THROWS. It is called fire-and-forget from a webhook that must answer
   * SignalWire regardless, and a summary is the least important thing happening on that
   * request. `createMany` + `skipDuplicates` rather than a create: both webhooks can
   * fire for one call, and the unique on `callSid` would otherwise throw P2002 on the
   * second — a caught-and-ignored error is still a lie in the logs.
   */
  async enqueue(input: {
    callSid: string;
    companyId?: number | null;
    recordingSid?: string | null;
  }): Promise<void> {
    if (!summarizeCalls(process.env)) return;
    if (!input.callSid) return;

    try {
      await this.prisma.callSummary.createMany({
        data: [
          {
            callSid: input.callSid,
            companyId: input.companyId ?? null,
            recordingSid: input.recordingSid ?? null,
            status: SUMMARY_STATUS.pending,
          },
        ],
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `could not enqueue summary for ${input.callSid}: ${errText(err)}`,
      );
    }
  }

  /**
   * The summary for a call the client is looking at, or null.
   *
   * Takes both sids because the row is keyed by the leg the `<Dial>` ran on while the
   * inbox shows the child leg for outbound calls — see `summaryLookupSids`.
   */
  async findForCall(
    sid: string,
    parentCallSid?: string | null,
  ): Promise<CallSummaryView | null> {
    const row = await this.prisma.callSummary.findFirst({
      where: { callSid: { in: summaryLookupSids(sid, parentCallSid) } },
      select: { status: true, summary: true, completedAt: true },
    });
    return row ? toSummaryView(row) : null;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (!summarizeCalls(process.env)) return;
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.runSweep();
    } catch (err) {
      // A cron that throws is a cron that logs a stack and nothing else useful.
      this.logger.error(`summary sweep failed: ${errText(err)}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async runSweep(): Promise<void> {
    const now = Date.now();
    // Claimable = PENDING, under the attempt cap, and past the backoff for the number of
    // attempts it has already made. The backoff is per-attempt, so it is compared in
    // memory over a small candidate set rather than expressed as SQL.
    const candidates = await this.prisma.callSummary.findMany({
      where: { status: SUMMARY_STATUS.pending, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { updatedAt: 'asc' },
      take: CallSummaryService.BATCH * 4,
    });
    const due = candidates
      .filter((r) => r.updatedAt <= claimableBefore(now, r.attempts))
      .slice(0, CallSummaryService.BATCH);
    if (due.length === 0) return;

    let next = 0;
    const worker = async () => {
      while (next < due.length) {
        const row = due[next++];
        try {
          await this.process(row);
        } catch (err) {
          await this.recordFailure(row.id, row.attempts, errText(err));
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(CallSummaryService.CONCURRENCY, due.length) },
        worker,
      ),
    );
  }

  private async process(row: {
    id: number;
    callSid: string;
    recordingSid: string | null;
    createdAt: Date;
    attempts: number;
  }): Promise<void> {
    const recording = await this.resolveRecording(row);
    if (!recording) {
      // Not found YET is the normal case for the first minute or so. Only past the grace
      // window does absent mean the call truly had no audio.
      if (Date.now() - row.createdAt.getTime() < RECORDING_GRACE_MS) return;
      await this.finish(row.id, {
        status: SUMMARY_STATUS.skipped,
        lastError: 'no recording found for this call',
      });
      this.logger.log(`summary ${row.callSid} skipped — no recording`);
      return;
    }

    const audio = await this.loadAudio(recording.sid);
    if (!audio) {
      await this.finish(row.id, {
        status: SUMMARY_STATUS.skipped,
        recordingSid: recording.sid,
        durationSec: recording.durationSec,
        lastError: 'recording too large to transcribe',
      });
      this.logger.warn(
        `summary ${row.callSid} skipped — recording ${recording.sid} exceeds the upload limit`,
      );
      return;
    }

    const startedAt = Date.now();
    const transcript = await this.ai.transcribeAudio(
      audio,
      `call-${recording.sid}.mp3`,
    );

    if (!isTranscriptUsable(transcript)) {
      // Silence or line noise. A confident sentence about nothing is worse than no
      // summary, and retrying would transcribe the same silence again.
      await this.finish(row.id, {
        status: SUMMARY_STATUS.skipped,
        recordingSid: recording.sid,
        durationSec: recording.durationSec,
        lastError: 'transcript was empty or too short',
      });
      this.logger.log(`summary ${row.callSid} skipped — nothing said`);
      return;
    }

    const model = summaryModel(process.env);
    const summary = await this.ai.summarizeCall(transcript, model);

    await this.finish(row.id, {
      status: SUMMARY_STATUS.ready,
      recordingSid: recording.sid,
      durationSec: recording.durationSec,
      summary,
      model,
      lastError: null,
    });
    this.logger.log(
      `summary ${row.callSid} ready in ${Date.now() - startedAt}ms ` +
        `(${recording.durationSec}s audio, ${transcript.length} transcript chars)`,
    );
  }

  /**
   * The recording to transcribe: the one the voicemail webhook named, or whatever the
   * shared parent-aware lookup finds.
   *
   * Longest first when there is a choice — a call put on hold can leave more than one
   * file, and the longest is the conversation rather than a fragment.
   */
  private async resolveRecording(row: {
    callSid: string;
    recordingSid: string | null;
  }): Promise<{ sid: string; durationSec: number } | null> {
    if (row.recordingSid) {
      const known = await this.signalwire.listRecordings({
        callSid: row.callSid,
      });
      const match = known.find((r) => r.sid === row.recordingSid);
      // The webhook told us the sid but not its duration; if the list disagrees, trust
      // the sid we were given and carry on with an unknown length.
      return { sid: row.recordingSid, durationSec: match?.durationSec ?? 0 };
    }

    const { recordings } = await this.timeline.findRecordingsForCall(
      row.callSid,
    );
    if (recordings.length === 0) return null;
    const best = [...recordings].sort(
      (a, b) => b.durationSec - a.durationSec,
    )[0];
    return { sid: best.sid, durationSec: best.durationSec };
  }

  /** Recording bytes, shrunk if they would be rejected. Null when it cannot be made to fit. */
  private async loadAudio(recordingSid: string): Promise<Buffer | null> {
    const { buffer } = await this.signalwire.fetchRecordingMedia(recordingSid);
    if (buffer.length <= MAX_UPLOAD_BYTES) return buffer;

    this.logger.log(
      `recording ${recordingSid} is ${buffer.length} bytes — re-encoding for upload`,
    );
    const { stdout, stderr, code } = await runFfmpegDetailed(
      buffer,
      TRANSCRIBE_MP3_ARGS,
    );
    if (code !== 0 || stdout.length === 0) {
      throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`);
    }
    // Still oversize after the shrink means a genuinely enormous call. Chunking is the
    // follow-up; refusing is honest in the meantime.
    return stdout.length <= MAX_UPLOAD_BYTES ? stdout : null;
  }

  private async finish(
    id: number,
    data: {
      status: string;
      summary?: string;
      model?: string;
      recordingSid?: string;
      durationSec?: number;
      lastError?: string | null;
    },
  ): Promise<void> {
    await this.prisma.callSummary.update({
      where: { id },
      data: { ...data, completedAt: new Date() },
    });
  }

  private async recordFailure(
    id: number,
    attempts: number,
    message: string,
  ): Promise<void> {
    const next = attempts + 1;
    const exhausted = next >= MAX_ATTEMPTS;
    try {
      await this.prisma.callSummary.update({
        where: { id },
        data: {
          attempts: next,
          lastError: message.slice(0, 2000),
          status: exhausted ? SUMMARY_STATUS.failed : SUMMARY_STATUS.pending,
          ...(exhausted && { completedAt: new Date() }),
        },
      });
    } catch (err) {
      this.logger.error(
        `could not record summary failure for row ${id}: ${errText(err)}`,
      );
    }
    this.logger[exhausted ? 'error' : 'warn'](
      `summary row ${id} attempt ${next}/${MAX_ATTEMPTS} failed: ${message}`,
    );
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
