export type SizeOp = 'gt' | 'lt';
export type SearchWithin = '1d' | '3d' | '1w' | '2w' | '1m' | '2m' | '6m' | '1y';
export type SearchScope = 'all' | 'inbox' | 'sent' | 'spam' | 'trash';
export interface EmailSearchFilters {
    from?: string;
    to?: string;
    subject?: string;
    words?: string;
    notWords?: string;
    sizeOp?: SizeOp;
    sizeBytes?: number;
    within?: SearchWithin;
    anchor?: string;
    hasAttachment?: boolean;
    scope?: SearchScope;
}
export declare function parseEmailSearchFilters(query: Record<string, string | undefined>): EmailSearchFilters | undefined;
export declare function withinRange(within: SearchWithin, anchor?: string): {
    after: Date;
    before: Date;
};
export declare function buildGmailQuery(free: string | undefined, f: EmailSearchFilters | undefined): string | undefined;
export declare function buildGraphSearch(free: string | undefined, f: EmailSearchFilters | undefined): string | undefined;
export declare function resolveScopeLabels(labelIds: string[] | undefined, scope: SearchScope | undefined): string[] | undefined;
