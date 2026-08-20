export declare const CROP_MARGIN = 1.8;
export declare const CROP_Y_BIAS = 0.06;
export declare const TARGET_FACE_PX = 320;
export declare const TARGET_SIDE = 576;
export declare const MAX_UPSCALE = 2;
export declare const MIN_SIDE = 256;
export declare const NO_BOX_MAX_EDGE = 1280;
export declare const CROP_MAX_COVERAGE = 0.9;
export declare const TONE_TARGET_MEAN = 128;
export declare const TONE_TARGET_STDEV = 55;
export declare const TONE_MEAN_LOW = 110;
export declare const TONE_MEAN_HIGH = 175;
export declare const TONE_STDEV_LOW = 45;
export declare const GAIN_MIN = 0.8;
export declare const GAIN_MAX = 1.6;
export declare const OFFSET_ABS_MAX = 60;
export declare const DENOISE_GAIN = 1.25;
export declare const DENOISE_DARK_MEAN = 80;
export declare const JPEG_QUALITY_LOGIN = 92;
export declare const JPEG_QUALITY_ENROL = 95;
export declare const BOX_EDGE_TOLERANCE = 0.01;
export declare const BOX_MIN_W = 0.05;
export declare const BOX_MAX_SIDE = 0.9;
export interface NormalizedBox {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface CropRect {
    left: number;
    top: number;
    width: number;
    height: number;
}
export interface LumaStats {
    mean: number;
    stdev: number;
    laplacianVar: number;
}
export interface ToneAdjustment {
    a: number;
    b: number;
}
export interface RawPhoto {
    buffer: Buffer;
    mimeType?: string;
}
export type EnhancedPhoto = RawPhoto & {
    readonly __enhanced: true;
};
export type PhotoMode = 'login' | 'enrol';
export declare function parseFaceBox(field: unknown): NormalizedBox | null;
export declare function parseFaceBoxes(field: unknown, count: number): (NormalizedBox | null)[];
export declare function cropRect(box: NormalizedBox, imgW: number, imgH: number): CropRect | null;
export declare function targetSide(cropSidePx: number): {
    side: number;
    upscaled: boolean;
};
export declare function noBoxResize(imgW: number, imgH: number): {
    width: number;
    height: number;
} | null;
export declare function resizeKernel(upscaled: boolean): 'lanczos3' | 'mitchell';
export declare function lumaStats(raw: Buffer | Uint8Array, width: number, height: number, channels: number, region?: 'all' | 'center'): LumaStats;
export declare function toneAdjustment(stats: LumaStats): ToneAdjustment | null;
export declare function needsDenoise(stats: LumaStats, tone: ToneAdjustment | null): boolean;
export declare function sharpenParams(upscaled: boolean): {
    sigma: number;
    m1: number;
    m2: number;
};
export declare function jpegQuality(mode: PhotoMode): number;
