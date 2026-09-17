export interface Placeable {
    id: string;
    at: string;
}
export declare function idsUpTo<T extends Placeable>(items: readonly T[], anchorId: string): string[] | null;
