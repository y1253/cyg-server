export declare const TELEPHONY_MP3_ARGS: string[];
export declare function parseDurationMs(ffmpegLog: string): number;
export declare function transcodeToTelephonyMp3(input: Buffer): Promise<{
    mp3: Buffer;
    durationMs: number;
}>;
export declare function audioIdOrNone(value: number | null | undefined): number | null;
