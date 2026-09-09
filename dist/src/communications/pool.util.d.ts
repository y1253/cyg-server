export declare const GMAIL_GET_CONCURRENCY = 6;
export declare function pool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]>;
