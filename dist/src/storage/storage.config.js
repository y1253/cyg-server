"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endpointFor = endpointFor;
exports.bucketName = bucketName;
exports.r2Config = r2Config;
exports.storageDriver = storageDriver;
exports.localFallbackEnabled = localFallbackEnabled;
const value = (raw) => (raw ?? '').trim();
const BUCKET_SHAPE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
function endpointFor(accountId) {
    return `https://${accountId}.r2.cloudflarestorage.com`;
}
function bucketName(env) {
    const raw = value(env.R2_BUCKET) || value(env.R2_BUCKET_NAME);
    if (raw === '')
        return null;
    if (!BUCKET_SHAPE.test(raw)) {
        throw new Error(`R2_BUCKET_NAME is "${raw}", which is not a bucket name. ` +
            'Set R2_BUCKET_NAME=cyg — this variable is the bucket NAME only; the endpoint ' +
            'is derived from R2_ACCOUNT_ID.');
    }
    return raw;
}
function r2Config(env) {
    const accountId = value(env.R2_ACCOUNT_ID);
    const accessKeyId = value(env.R2_ACCESS_KEY_ID);
    const secretAccessKey = value(env.R2_SECRET_ACCESS_KEY);
    if (!accountId || !accessKeyId || !secretAccessKey)
        return null;
    const bucket = bucketName(env);
    if (!bucket)
        return null;
    return {
        accountId,
        accessKeyId,
        secretAccessKey,
        bucket,
        endpoint: endpointFor(accountId),
    };
}
function storageDriver(env) {
    const raw = value(env.STORAGE_DRIVER).toLowerCase();
    if (raw === 'local')
        return 'local';
    if (raw === '')
        return r2Config(env) ? 'r2' : 'local';
    if (raw === 'r2') {
        if (!r2Config(env)) {
            throw new Error('STORAGE_DRIVER=r2 but R2 is not fully configured. Set R2_ACCOUNT_ID, ' +
                'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME — or set ' +
                'STORAGE_DRIVER=local to keep files on disk.');
        }
        return 'r2';
    }
    throw new Error(`STORAGE_DRIVER is "${raw}". Valid values are "r2", "local", or blank ` +
        '(which picks r2 when credentials are present).');
}
function localFallbackEnabled(env) {
    return value(env.STORAGE_LOCAL_FALLBACK) !== '0';
}
//# sourceMappingURL=storage.config.js.map