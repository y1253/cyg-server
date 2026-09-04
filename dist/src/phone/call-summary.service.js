"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CallSummaryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallSummaryService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const ai_service_js_1 = require("../ai/ai.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const phone_timeline_service_js_1 = require("./phone-timeline.service.js");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const phone_config_js_1 = require("./phone.config.js");
const call_summary_util_js_1 = require("./call-summary.util.js");
let CallSummaryService = class CallSummaryService {
    static { CallSummaryService_1 = this; }
    prisma;
    signalwire;
    timeline;
    ai;
    logger = new common_1.Logger(CallSummaryService_1.name);
    static BATCH = 5;
    static CONCURRENCY = 2;
    sweeping = false;
    constructor(prisma, signalwire, timeline, ai) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.timeline = timeline;
        this.ai = ai;
    }
    async enqueue(input) {
        if (!(0, phone_config_js_1.summarizeCalls)(process.env))
            return;
        if (!input.callSid)
            return;
        try {
            await this.prisma.callSummary.createMany({
                data: [
                    {
                        callSid: input.callSid,
                        companyId: input.companyId ?? null,
                        recordingSid: input.recordingSid ?? null,
                        status: call_summary_util_js_1.SUMMARY_STATUS.pending,
                    },
                ],
                skipDuplicates: true,
            });
        }
        catch (err) {
            this.logger.warn(`could not enqueue summary for ${input.callSid}: ${errText(err)}`);
        }
    }
    async findForCall(sid, parentCallSid) {
        const row = await this.prisma.callSummary.findFirst({
            where: { callSid: { in: (0, call_summary_util_js_1.summaryLookupSids)(sid, parentCallSid) } },
            select: { status: true, summary: true, completedAt: true },
        });
        return row ? (0, call_summary_util_js_1.toSummaryView)(row) : null;
    }
    async sweep() {
        if (!(0, phone_config_js_1.summarizeCalls)(process.env))
            return;
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            await this.runSweep();
        }
        catch (err) {
            this.logger.error(`summary sweep failed: ${errText(err)}`);
        }
        finally {
            this.sweeping = false;
        }
    }
    async runSweep() {
        const now = Date.now();
        const candidates = await this.prisma.callSummary.findMany({
            where: { status: call_summary_util_js_1.SUMMARY_STATUS.pending, attempts: { lt: call_summary_util_js_1.MAX_ATTEMPTS } },
            orderBy: { updatedAt: 'asc' },
            take: CallSummaryService_1.BATCH * 4,
        });
        const due = candidates
            .filter((r) => r.updatedAt <= (0, call_summary_util_js_1.claimableBefore)(now, r.attempts))
            .slice(0, CallSummaryService_1.BATCH);
        if (due.length === 0)
            return;
        let next = 0;
        const worker = async () => {
            while (next < due.length) {
                const row = due[next++];
                try {
                    await this.process(row);
                }
                catch (err) {
                    await this.recordFailure(row.id, row.attempts, errText(err));
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(CallSummaryService_1.CONCURRENCY, due.length) }, worker));
    }
    async process(row) {
        const recording = await this.resolveRecording(row);
        if (!recording) {
            if (Date.now() - row.createdAt.getTime() < call_summary_util_js_1.RECORDING_GRACE_MS)
                return;
            await this.finish(row.id, {
                status: call_summary_util_js_1.SUMMARY_STATUS.skipped,
                lastError: 'no recording found for this call',
            });
            this.logger.log(`summary ${row.callSid} skipped — no recording`);
            return;
        }
        const audio = await this.loadAudio(recording.sid);
        if (!audio) {
            await this.finish(row.id, {
                status: call_summary_util_js_1.SUMMARY_STATUS.skipped,
                recordingSid: recording.sid,
                durationSec: recording.durationSec,
                lastError: 'recording too large to transcribe',
            });
            this.logger.warn(`summary ${row.callSid} skipped — recording ${recording.sid} exceeds the upload limit`);
            return;
        }
        const startedAt = Date.now();
        const transcript = await this.ai.transcribeAudio(audio, `call-${recording.sid}.mp3`);
        if (!(0, call_summary_util_js_1.isTranscriptUsable)(transcript)) {
            await this.finish(row.id, {
                status: call_summary_util_js_1.SUMMARY_STATUS.skipped,
                recordingSid: recording.sid,
                durationSec: recording.durationSec,
                lastError: 'transcript was empty or too short',
            });
            this.logger.log(`summary ${row.callSid} skipped — nothing said`);
            return;
        }
        const model = (0, phone_config_js_1.summaryModel)(process.env);
        const summary = await this.ai.summarizeCall(transcript, model);
        await this.finish(row.id, {
            status: call_summary_util_js_1.SUMMARY_STATUS.ready,
            recordingSid: recording.sid,
            durationSec: recording.durationSec,
            summary,
            model,
            lastError: null,
        });
        this.logger.log(`summary ${row.callSid} ready in ${Date.now() - startedAt}ms ` +
            `(${recording.durationSec}s audio, ${transcript.length} transcript chars)`);
    }
    async resolveRecording(row) {
        if (row.recordingSid) {
            const known = await this.signalwire.listRecordings({
                callSid: row.callSid,
            });
            const match = known.find((r) => r.sid === row.recordingSid);
            return { sid: row.recordingSid, durationSec: match?.durationSec ?? 0 };
        }
        const { recordings } = await this.timeline.findRecordingsForCall(row.callSid);
        if (recordings.length === 0)
            return null;
        const best = [...recordings].sort((a, b) => b.durationSec - a.durationSec)[0];
        return { sid: best.sid, durationSec: best.durationSec };
    }
    async loadAudio(recordingSid) {
        const { buffer } = await this.signalwire.fetchRecordingMedia(recordingSid);
        if (buffer.length <= call_summary_util_js_1.MAX_UPLOAD_BYTES)
            return buffer;
        this.logger.log(`recording ${recordingSid} is ${buffer.length} bytes — re-encoding for upload`);
        const { stdout, stderr, code } = await (0, attachment_stream_util_js_1.runFfmpegDetailed)(buffer, call_summary_util_js_1.TRANSCRIBE_MP3_ARGS);
        if (code !== 0 || stdout.length === 0) {
            throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`);
        }
        return stdout.length <= call_summary_util_js_1.MAX_UPLOAD_BYTES ? stdout : null;
    }
    async finish(id, data) {
        await this.prisma.callSummary.update({
            where: { id },
            data: { ...data, completedAt: new Date() },
        });
    }
    async recordFailure(id, attempts, message) {
        const next = attempts + 1;
        const exhausted = next >= call_summary_util_js_1.MAX_ATTEMPTS;
        try {
            await this.prisma.callSummary.update({
                where: { id },
                data: {
                    attempts: next,
                    lastError: message.slice(0, 2000),
                    status: exhausted ? call_summary_util_js_1.SUMMARY_STATUS.failed : call_summary_util_js_1.SUMMARY_STATUS.pending,
                    ...(exhausted && { completedAt: new Date() }),
                },
            });
        }
        catch (err) {
            this.logger.error(`could not record summary failure for row ${id}: ${errText(err)}`);
        }
        this.logger[exhausted ? 'error' : 'warn'](`summary row ${id} attempt ${next}/${call_summary_util_js_1.MAX_ATTEMPTS} failed: ${message}`);
    }
};
exports.CallSummaryService = CallSummaryService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CallSummaryService.prototype, "sweep", null);
exports.CallSummaryService = CallSummaryService = CallSummaryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService,
        phone_timeline_service_js_1.PhoneTimelineService,
        ai_service_js_1.AiService])
], CallSummaryService);
function errText(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=call-summary.service.js.map