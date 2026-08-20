export declare function referencedCidsFromHtml(bodyHtml: string | null | undefined): Set<string>;
export declare function normalizeContentId(rawContentId: string | null | undefined): string | null;
export declare function isBodyEmbedded(contentId: string | null | undefined, referencedCids: Set<string>): boolean;
