export type DocumentKind = 'text' | 'pdf' | 'image';
export declare function documentKind(mimetype: string, filename: string): {
    kind: DocumentKind;
} | {
    refuse: string;
};
export declare function mimeForFilename(filename: string): string;
