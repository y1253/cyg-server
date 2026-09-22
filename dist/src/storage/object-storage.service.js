"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ObjectStorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectStorageService = void 0;
const fs_1 = require("fs");
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const lib_storage_1 = require("@aws-sdk/lib-storage");
const storage_config_js_1 = require("./storage.config.js");
const PART_SIZE = 8 * 1024 * 1024;
const PART_CONCURRENCY = 4;
let ObjectStorageService = ObjectStorageService_1 = class ObjectStorageService {
    logger = new common_1.Logger(ObjectStorageService_1.name);
    config;
    driver;
    client = null;
    constructor() {
        this.config = (0, storage_config_js_1.r2Config)(process.env);
        this.driver = (0, storage_config_js_1.storageDriver)(process.env);
        if (this.driver === 'local') {
            this.logger.warn('STORAGE_DRIVER=local — files are read and written on local disk, not R2.');
        }
        else {
            this.logger.log(`object storage: r2 bucket "${this.config?.bucket}"`);
        }
    }
    s3() {
        if (!this.config) {
            throw new Error('R2 is not configured (STORAGE_DRIVER=local). This call should not have been reached.');
        }
        if (!this.client) {
            this.client = new client_s3_1.S3Client({
                region: 'auto',
                endpoint: this.config.endpoint,
                forcePathStyle: true,
                credentials: {
                    accessKeyId: this.config.accessKeyId,
                    secretAccessKey: this.config.secretAccessKey,
                },
                requestChecksumCalculation: 'WHEN_REQUIRED',
                responseChecksumValidation: 'WHEN_REQUIRED',
            });
        }
        return this.client;
    }
    assertKey(key) {
        const bad = !key ||
            key !== key.trim() ||
            key.startsWith('/') ||
            key.includes('\\') ||
            key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
        if (bad)
            throw new Error(`Refusing a malformed storage key: "${key}"`);
    }
    async putBuffer(key, body, contentType) {
        this.assertKey(key);
        await this.s3().send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket(),
            Key: key,
            Body: body,
            ContentType: contentType,
        }));
    }
    async putFile(key, absolutePath, contentType) {
        this.assertKey(key);
        const upload = new lib_storage_1.Upload({
            client: this.s3(),
            partSize: PART_SIZE,
            queueSize: PART_CONCURRENCY,
            params: {
                Bucket: this.bucket(),
                Key: key,
                Body: (0, fs_1.createReadStream)(absolutePath),
                ContentType: contentType,
            },
        });
        await upload.done();
    }
    async head(key) {
        this.assertKey(key);
        try {
            const res = await this.s3().send(new client_s3_1.HeadObjectCommand({ Bucket: this.bucket(), Key: key }));
            return {
                size: res.ContentLength ?? 0,
                contentType: res.ContentType,
            };
        }
        catch (err) {
            if (this.isNotFound(err))
                return null;
            throw err;
        }
    }
    async getStream(key, range) {
        this.assertKey(key);
        const res = await this.s3().send(new client_s3_1.GetObjectCommand({
            Bucket: this.bucket(),
            Key: key,
            Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }));
        if (!res.Body)
            throw new Error(`R2 returned no body for "${key}"`);
        if (range) {
            const want = range.end - range.start + 1;
            if (res.ContentLength !== undefined && res.ContentLength !== want) {
                this.logger.warn(`range mismatch for "${key}": asked ${want}B, got ${res.ContentLength}B`);
            }
        }
        return res.Body;
    }
    async getBuffer(key) {
        const stream = await this.getStream(key, null);
        const chunks = [];
        for await (const chunk of stream)
            chunks.push(chunk);
        return Buffer.concat(chunks);
    }
    async delete(key) {
        this.assertKey(key);
        await this.s3().send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
    }
    bucket() {
        if (!this.config)
            throw new Error('R2 is not configured');
        return this.config.bucket;
    }
    isNotFound(err) {
        const e = err;
        return (e?.$metadata?.httpStatusCode === 404 ||
            e?.name === 'NoSuchKey' ||
            e?.name === 'NotFound');
    }
};
exports.ObjectStorageService = ObjectStorageService;
exports.ObjectStorageService = ObjectStorageService = ObjectStorageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ObjectStorageService);
//# sourceMappingURL=object-storage.service.js.map