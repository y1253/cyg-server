import { CallSummaryService } from './call-summary.service';
import { SUMMARY_STATUS, MAX_ATTEMPTS } from './call-summary.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';
import type { PhoneTimelineService } from './phone-timeline.service';
import type { AiService } from '../ai/ai.service';
import { runFfmpegDetailed } from '../communications/attachment-stream.util';

// The shrink pass is mocked so the oversize BRANCHES can be exercised deterministically.
// Feeding real ffmpeg a buffer of zeros only proves it rejects undecodable bytes, which
// is a different code path (a retryable error) from the one worth pinning here.
jest.mock('../communications/attachment-stream.util', () => ({
  runFfmpegDetailed: jest.fn(),
}));
const mockFfmpeg = runFfmpegDetailed as jest.MockedFunction<
  typeof runFfmpegDetailed
>;

/**
 * The summary worker's state machine.
 *
 * SignalWire is unreachable from a dev machine (the office TLS proxy) and every real run
 * costs money, so this is where the confidence has to live. Each case below decides
 * either whether money is spent or whether a row gets stuck forever.
 */
describe('CallSummaryService', () => {
  const OLD_ENV = { ...process.env };

  let rows: Record<string, unknown>[];
  let updates: { id: number; data: Record<string, unknown> }[];
  let created: Record<string, unknown>[];
  /** The full args of the last createMany, so the spec need not read `.mock.calls`. */
  let createArgs: { skipDuplicates?: boolean } | null;
  /** The bytes actually handed to the transcription API. */
  let uploaded: Buffer | null;

  function build(over: {
    recordings?: { sid: string; durationSec: number }[];
    transcript?: string;
    summary?: string;
    media?: Buffer;
    transcribeError?: Error;
  }) {
    const signalwire = {
      listRecordings: jest.fn().mockResolvedValue(over.recordings ?? []),
      fetchRecordingMedia: jest.fn().mockResolvedValue({
        buffer: over.media ?? Buffer.alloc(1024),
        contentType: 'audio/mpeg',
      }),
    };
    const timeline = {
      findRecordingsForCall: jest
        .fn()
        .mockResolvedValue({ recordings: over.recordings ?? [], onSid: 'x' }),
    };
    const ai = {
      transcribeAudio: over.transcribeError
        ? jest.fn().mockRejectedValue(over.transcribeError)
        : jest.fn().mockImplementation((audio: Buffer) => {
            uploaded = audio;
            return Promise.resolve(
              over.transcript ??
                'Hello, I am calling about the quarterly filing deadline please.',
            );
          }),
      summarizeCall: jest
        .fn()
        .mockResolvedValue(over.summary ?? 'Caller asked about the deadline.'),
    };
    const prisma = {
      callSummary: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(rows)),
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest
          .fn()
          .mockImplementation(
            (args: { data: unknown[]; skipDuplicates?: boolean }) => {
              createArgs = args;
              created.push(...(args.data as Record<string, unknown>[]));
              return Promise.resolve({ count: args.data.length });
            },
          ),
        update: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { id: number };
              data: Record<string, unknown>;
            }) => {
              updates.push({ id: args.where.id, data: args.data });
              return Promise.resolve({});
            },
          ),
      },
    };

    const svc = new CallSummaryService(
      prisma as unknown as PrismaService,
      signalwire as unknown as SignalWireService,
      timeline as unknown as PhoneTimelineService,
      ai as unknown as AiService,
    );
    (svc as unknown as { logger: unknown }).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    return { svc, signalwire, timeline, ai, prisma };
  }

  /** A claimable PENDING row, old enough to be past both the grace and the backoff. */
  function pendingRow(over: Record<string, unknown> = {}) {
    return {
      id: 1,
      callSid: 'call-1',
      companyId: 4,
      recordingSid: null,
      status: SUMMARY_STATUS.pending,
      attempts: 0,
      createdAt: new Date(Date.now() - 60 * 60_000),
      updatedAt: new Date(Date.now() - 60 * 60_000),
      ...over,
    };
  }

  beforeEach(() => {
    rows = [];
    updates = [];
    created = [];
    createArgs = null;
    uploaded = null;
    mockFfmpeg.mockReset();
    process.env = { ...OLD_ENV, PHONE_SUMMARIZE_CALLS: '1' };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  const last = () => updates[updates.length - 1];

  describe('the kill switch', () => {
    it('enqueues nothing when PHONE_SUMMARIZE_CALLS is unset', async () => {
      process.env = { ...OLD_ENV };
      delete process.env.PHONE_SUMMARIZE_CALLS;
      const { svc } = build({});
      await svc.enqueue({ callSid: 'call-1', companyId: 4 });
      expect(created).toEqual([]);
    });

    it('sweeps nothing when it is off, even with rows waiting', async () => {
      process.env.PHONE_SUMMARIZE_CALLS = '0';
      rows = [pendingRow()];
      const { svc, ai } = build({
        recordings: [{ sid: 'rec', durationSec: 30 }],
      });
      await svc.sweep();
      expect(ai.transcribeAudio).not.toHaveBeenCalled();
    });
  });

  describe('enqueue', () => {
    it('writes a PENDING row', async () => {
      const { svc } = build({});
      await svc.enqueue({ callSid: 'call-1', companyId: 4 });
      expect(created[0]).toMatchObject({
        callSid: 'call-1',
        companyId: 4,
        status: SUMMARY_STATUS.pending,
      });
    });

    it('records a null company for an internal staff call', async () => {
      const { svc } = build({});
      await svc.enqueue({ callSid: 'call-1', companyId: null });
      expect(created[0]).toMatchObject({ companyId: null });
    });

    it('skips duplicates rather than throwing — both webhooks can fire', async () => {
      const { svc } = build({});
      await svc.enqueue({ callSid: 'call-1' });
      expect(createArgs).toMatchObject({ skipDuplicates: true });
    });

    it('NEVER throws — it is called fire-and-forget from a webhook', async () => {
      const { svc, prisma } = build({});
      prisma.callSummary.createMany.mockRejectedValue(new Error('db down'));
      await expect(svc.enqueue({ callSid: 'call-1' })).resolves.toBeUndefined();
    });
  });

  describe('no recording — the free exit that keeps misdials from costing money', () => {
    it('leaves the row PENDING inside the grace window', async () => {
      // SignalWire finalises a recording seconds after the call ends, so "not yet" is
      // the normal case immediately after the status webhook fires.
      rows = [pendingRow({ createdAt: new Date(), updatedAt: new Date(0) })];
      const { svc, ai } = build({ recordings: [] });
      await svc.sweep();
      expect(updates).toEqual([]);
      expect(ai.transcribeAudio).not.toHaveBeenCalled();
    });

    it('SKIPS once the grace window has passed, spending nothing', async () => {
      rows = [pendingRow()];
      const { svc, ai } = build({ recordings: [] });
      await svc.sweep();
      expect(last().data).toMatchObject({ status: SUMMARY_STATUS.skipped });
      expect(ai.transcribeAudio).not.toHaveBeenCalled();
    });
  });

  describe('the happy path', () => {
    it('transcribes, summarises and stores READY', async () => {
      rows = [pendingRow()];
      const { svc, ai } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
      });
      await svc.sweep();
      expect(ai.transcribeAudio).toHaveBeenCalledTimes(1);
      expect(ai.summarizeCall).toHaveBeenCalledTimes(1);
      expect(last().data).toMatchObject({
        status: SUMMARY_STATUS.ready,
        recordingSid: 'rec-1',
        durationSec: 42,
        summary: 'Caller asked about the deadline.',
      });
    });

    it('does NOT store the transcript', async () => {
      // Storing only the summary was a deliberate decision; this is what keeps it true.
      rows = [pendingRow()];
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
        transcript: 'A very distinctive transcript sentence about bookkeeping.',
      });
      await svc.sweep();
      expect(JSON.stringify(last().data)).not.toContain('distinctive');
    });

    it('picks the LONGEST recording when a held call left several', async () => {
      rows = [pendingRow()];
      const { svc, signalwire } = build({
        recordings: [
          { sid: 'short', durationSec: 3 },
          { sid: 'long', durationSec: 300 },
        ],
      });
      await svc.sweep();
      expect(signalwire.fetchRecordingMedia).toHaveBeenCalledWith('long');
    });

    it('uses the sid the voicemail webhook supplied, skipping the lookup', async () => {
      rows = [pendingRow({ recordingSid: 'vm-1' })];
      const { svc, signalwire, timeline } = build({
        recordings: [{ sid: 'vm-1', durationSec: 12 }],
      });
      await svc.sweep();
      expect(timeline.findRecordingsForCall).not.toHaveBeenCalled();
      expect(signalwire.fetchRecordingMedia).toHaveBeenCalledWith('vm-1');
    });
  });

  describe('nothing was said', () => {
    it('SKIPS an empty transcript instead of summarising silence', async () => {
      rows = [pendingRow()];
      const { svc, ai } = build({
        recordings: [{ sid: 'rec-1', durationSec: 4 }],
        transcript: '',
      });
      await svc.sweep();
      expect(ai.summarizeCall).not.toHaveBeenCalled();
      expect(last().data).toMatchObject({ status: SUMMARY_STATUS.skipped });
    });

    it('does not retry it — the silence would transcribe the same way again', async () => {
      rows = [pendingRow()];
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 4 }],
        transcript: 'uh',
      });
      await svc.sweep();
      expect(last().data).not.toHaveProperty('attempts');
    });
  });

  describe('failure and the retry budget', () => {
    it('stays PENDING with attempts++ on a transient failure', async () => {
      rows = [pendingRow()];
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
        transcribeError: new Error('rate limited'),
      });
      await svc.sweep();
      expect(last().data).toMatchObject({
        status: SUMMARY_STATUS.pending,
        attempts: 1,
      });
    });

    it('gives up as FAILED once the budget is spent', async () => {
      rows = [pendingRow({ attempts: MAX_ATTEMPTS - 1 })];
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
        transcribeError: new Error('still broken'),
      });
      await svc.sweep();
      expect(last().data).toMatchObject({
        status: SUMMARY_STATUS.failed,
        attempts: MAX_ATTEMPTS,
      });
    });

    it('truncates the stored error rather than writing an essay to the column', async () => {
      rows = [pendingRow()];
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
        transcribeError: new Error('x'.repeat(9000)),
      });
      await svc.sweep();
      expect((last().data.lastError as string).length).toBeLessThanOrEqual(
        2000,
      );
    });
  });

  describe('sweep discipline', () => {
    it('never claims a row still inside its backoff', async () => {
      rows = [pendingRow({ attempts: 1, updatedAt: new Date() })];
      const { svc, ai } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
      });
      await svc.sweep();
      expect(ai.transcribeAudio).not.toHaveBeenCalled();
    });

    it('does not re-enter while a slow sweep is still running', async () => {
      // Without the guard, a transcription longer than the cron interval means two ticks
      // claim the same rows — paying OpenAI twice for one call.
      rows = [pendingRow()];
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { svc, ai } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
      });
      ai.transcribeAudio.mockImplementation(async () => {
        await gate;
        return 'Hello, this is a real sentence about quarterly filings.';
      });

      const first = svc.sweep();
      await svc.sweep(); // the next tick, while the first is still in flight
      release();
      await first;

      expect(ai.transcribeAudio).toHaveBeenCalledTimes(1);
    });

    it('caps how many rows one tick touches', async () => {
      rows = Array.from({ length: 20 }, (_, i) => pendingRow({ id: i + 1 }));
      const { svc, ai } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
      });
      await svc.sweep();
      expect(ai.transcribeAudio.mock.calls.length).toBeLessThanOrEqual(5);
    });
  });

  describe('oversize audio', () => {
    const OVERSIZE = Buffer.alloc(30 * 1024 * 1024);

    it('does not touch ffmpeg when the file already fits', async () => {
      rows = [pendingRow()];
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 42 }],
        media: Buffer.alloc(1024),
      });
      await svc.sweep();
      expect(mockFfmpeg).not.toHaveBeenCalled();
    });

    it('re-encodes an oversize recording and transcribes the smaller one', async () => {
      rows = [pendingRow()];
      const shrunk = Buffer.alloc(2 * 1024 * 1024);
      mockFfmpeg.mockResolvedValue({ stdout: shrunk, stderr: '', code: 0 });
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 9000 }],
        media: OVERSIZE,
      });
      await svc.sweep();
      expect(mockFfmpeg).toHaveBeenCalledTimes(1);
      expect(uploaded).toBe(shrunk);
      expect(last().data).toMatchObject({ status: SUMMARY_STATUS.ready });
    });

    it('SKIPS when even the re-encode cannot get it under the cap', async () => {
      // Terminal, not a retry: the file will be the same size next time. Chunking is the
      // follow-up; refusing is honest in the meantime.
      rows = [pendingRow()];
      mockFfmpeg.mockResolvedValue({ stdout: OVERSIZE, stderr: '', code: 0 });
      const { svc, ai } = build({
        recordings: [{ sid: 'rec-1', durationSec: 99999 }],
        media: OVERSIZE,
      });
      await svc.sweep();
      expect(ai.transcribeAudio).not.toHaveBeenCalled();
      expect(last().data).toMatchObject({ status: SUMMARY_STATUS.skipped });
    });

    it('treats an ffmpeg failure as retryable, not as a skip', async () => {
      rows = [pendingRow()];
      mockFfmpeg.mockResolvedValue({
        stdout: Buffer.alloc(0),
        stderr: 'boom',
        code: 1,
      });
      const { svc } = build({
        recordings: [{ sid: 'rec-1', durationSec: 9000 }],
        media: OVERSIZE,
      });
      await svc.sweep();
      expect(last().data).toMatchObject({
        status: SUMMARY_STATUS.pending,
        attempts: 1,
      });
    });
  });
});
