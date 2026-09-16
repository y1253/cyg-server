export interface ImageRung {
    edge: number;
    quality: number;
}
export declare const MMS_IMAGE_LADDER: readonly ImageRung[];
export declare const MMS_AUDIO_ARGS: string[];
export declare function perFileBudget(total: number, fileCount: number): number;
export declare function mmsMediaClass(contentType: string | undefined): 'image' | 'audio' | 'other';
