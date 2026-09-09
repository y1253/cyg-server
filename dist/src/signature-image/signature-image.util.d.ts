export declare const MAX_LOGO_EDGE_PX = 600;
export interface Dimensions {
    width: number;
    height: number;
}
export declare function boundedSize(source: Dimensions): Dimensions;
export declare function defaultImageName(originalName: string): string;
