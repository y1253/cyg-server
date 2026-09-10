export declare const MAX_LOGO_EDGE_PX = 600;
export interface Dimensions {
    width: number;
    height: number;
}
export declare function boundedSize(source: Dimensions): Dimensions;
export declare function defaultImageName(originalName: string): string;
export type ImageScope = number | null;
export declare function isImageVisibleTo(image: ImageScope, scope: ImageScope): boolean;
export declare function isImageInLibrary(image: ImageScope, scope: ImageScope): boolean;
export declare function imageScopeWhere(scope: ImageScope): {
    companyId: null;
    OR?: undefined;
} | {
    OR: ({
        companyId: null;
    } | {
        companyId: number;
    })[];
    companyId?: undefined;
};
export declare const MAX_COMPANY_LOGOS = 10;
