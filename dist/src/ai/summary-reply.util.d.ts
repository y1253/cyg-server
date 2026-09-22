export declare const SHORT_SUMMARY_MAX_CHARS = 120;
export declare function clipToLine(text: string, max?: number): string;
export declare function parseSummaryReply(raw: string): {
    short: string;
    brief: string;
};
