export type StorageDriver = 'r2' | 'local';
export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint: string;
}
type Env = Record<string, string | undefined>;
export declare function endpointFor(accountId: string): string;
export declare function bucketName(env: Env): string | null;
export declare function r2Config(env: Env): R2Config | null;
export declare function storageDriver(env: Env): StorageDriver;
export declare function localFallbackEnabled(env: Env): boolean;
export {};
