export declare const SUMMARY_STATUS: {
    readonly pending: "PENDING";
    readonly ready: "READY";
    readonly skipped: "SKIPPED";
    readonly failed: "FAILED";
};
export type SummaryStatus = (typeof SUMMARY_STATUS)[keyof typeof SUMMARY_STATUS];
export declare const RECORDING_GRACE_MS: number;
export declare const MAX_UPLOAD_BYTES: number;
export declare const TRANSCRIBE_MP3_ARGS: string[];
export declare const MAX_ATTEMPTS = 4;
export declare function retryDelayMs(attempts: number): number;
export declare function claimableBefore(now: number, attempts: number): Date;
export declare const MIN_TRANSCRIPT_CHARS = 20;
export declare function isTranscriptUsable(transcript: string): boolean;
export declare function summaryLookupSids(sid: string, parentCallSid?: string | null): string[];
export interface CallSummaryView {
    status: 'pending' | 'ready' | 'skipped' | 'failed';
    summary: string | null;
    reason: string | null;
    generatedAt: string | null;
}
export declare function toSummaryView(row: {
    status: string;
    summary: string | null;
    completedAt: Date | null;
}): CallSummaryView;
