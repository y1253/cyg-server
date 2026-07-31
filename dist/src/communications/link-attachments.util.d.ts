export type LinkProvider = 'drive' | 'onedrive';
export interface SharedLink {
    name: string;
    size: number;
    url: string;
}
export declare function formatBytes(bytes: number): string;
export declare function buildLinkBlockHtml(links: SharedLink[], provider: LinkProvider): string;
export declare function buildLinkBlockText(links: SharedLink[], provider: LinkProvider): string;
export declare function appendLinkBlock(body: string, bodyHtml: string | undefined, links: SharedLink[], provider: LinkProvider): {
    body: string;
    bodyHtml?: string;
};
