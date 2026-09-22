import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  r2Config,
  storageDriver,
  type R2Config,
  type StorageDriver,
} from './storage.config.js';

/** A byte range, inclusive at both ends — the shape `parseRange` already produces. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface ObjectInfo {
  size: number;
  contentType?: string;
}

/**
 * Every part except the last must be THIS size — R2 is stricter than S3, which allows a
 * ragged tail. `Upload` uses one fixed size for all parts, so it complies; hand-rolling
 * multipart is how that rule gets broken.
 */
const PART_SIZE = 8 * 1024 * 1024;
const PART_CONCURRENCY = 4;

/**
 * Reads and writes the persisted file corpus in Cloudflare R2.
 *
 * The object key IS the value already stored in `storagePath` / `playbackPath` —
 * `messages/<uuid>.pdf`, `whatsapp/<uuid>.ogg`. Nothing here ever mints a URL into the
 * database, which is what lets the account, bucket or host change without touching a row.
 *
 * Verified against the live bucket by `scripts/r2-probe.mjs`: ranged and suffix GETs, a
 * 404 on a missing key, and an exact size from HEAD.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly config: R2Config | null;
  readonly driver: StorageDriver;
  private client: S3Client | null = null;

  constructor() {
    // Read once at construction, the signalwire.service.ts convention. `storageDriver`
    // throws on a misconfiguration, so a bad STORAGE_DRIVER or a URL-shaped bucket fails
    // the BOOT rather than the first upload — see storage.config.ts for why that is the
    // one place guessing is not acceptable.
    this.config = r2Config(process.env);
    this.driver = storageDriver(process.env);
    if (this.driver === 'local') {
      this.logger.warn(
        'STORAGE_DRIVER=local — files are read and written on local disk, not R2.',
      );
    } else {
      this.logger.log(`object storage: r2 bucket "${this.config?.bucket}"`);
    }
  }

  /**
   * Built lazily so a `local` deployment never constructs a client, and so the
   * credentials are touched only by code paths that actually reach the network.
   */
  private s3(): S3Client {
    if (!this.config) {
      throw new Error(
        'R2 is not configured (STORAGE_DRIVER=local). This call should not have been reached.',
      );
    }
    if (!this.client) {
      this.client = new S3Client({
        region: 'auto', // R2 has no regions; the SDK still demands the field.
        endpoint: this.config.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
        // The SDK's default flexible checksums DO work against R2 today (proven by
        // scripts/r2-probe.mjs). This pins the narrower behaviour anyway: the default has
        // broken against R2 before, and when it does every PUT fails at once. The SDK
        // version is pinned exactly in package.json for the same reason.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    }
    return this.client;
  }

  /**
   * Refuse a malformed key before it mints an object nothing can address again.
   *
   * ⚠️ This is NOT `resolveStoredPath`'s traversal check, and the difference is worth
   * keeping straight: on R2 `..` is a literal path segment, not an escape — there is no
   * parent directory to climb out to. The guard is here because (a) a key with an empty
   * or dotted segment is a silent data-loss bug at write time, and (b) the same string is
   * handed to the local-disk fallback, where traversal is real.
   */
  assertKey(key: string): void {
    const bad =
      !key ||
      key !== key.trim() ||
      key.startsWith('/') ||
      key.includes('\\') ||
      key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
    if (bad) throw new Error(`Refusing a malformed storage key: "${key}"`);
  }

  /** Write bytes we are already holding. For anything on disk, use `putFile`. */
  async putBuffer(
    key: string,
    body: Buffer,
    contentType?: string,
  ): Promise<void> {
    this.assertKey(key);
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
        // Never send ACL: R2 has no ACLs and rejects the header. The bucket is private
        // and every byte leaves through our own authenticated routes.
      }),
    );
  }

  /**
   * Stream a staged file straight to R2 without reading it into memory.
   *
   * This is the 250 MB path. `Upload` multiparts above `PART_SIZE` and retries a single
   * failed part, where a bare PutObject over a stream restarts the whole transfer on any
   * blip; below that size it degrades to one PutObject on its own, so there is no
   * threshold to tune here.
   */
  async putFile(
    key: string,
    absolutePath: string,
    contentType?: string,
  ): Promise<void> {
    this.assertKey(key);
    const upload = new Upload({
      client: this.s3(),
      partSize: PART_SIZE,
      queueSize: PART_CONCURRENCY,
      params: {
        Bucket: this.bucket(),
        Key: key,
        Body: createReadStream(absolutePath),
        ContentType: contentType,
      },
    });
    await upload.done();
  }

  /**
   * Size and type, or null when the object is not there.
   *
   * Null rather than a throw because "missing" is an ordinary answer on the read path —
   * it is what selects the local-disk fallback during the rollout — and because this is
   * the exact analogue of the `stat` that gives `streamAttachmentFile` its
   * clean-404-before-any-header guarantee.
   */
  async head(key: string): Promise<ObjectInfo | null> {
    this.assertKey(key);
    try {
      const res = await this.s3().send(
        new HeadObjectCommand({ Bucket: this.bucket(), Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
      };
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * The bytes, whole or ranged.
   *
   * The caller has already decided the range against a size from `head`, so the response's
   * own `ContentLength`/`ContentRange` are never used to build our headers — they are only
   * worth a warning if they disagree.
   */
  async getStream(key: string, range: ByteRange | null): Promise<Readable> {
    this.assertKey(key);
    const res = await this.s3().send(
      new GetObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    if (!res.Body) throw new Error(`R2 returned no body for "${key}"`);

    if (range) {
      const want = range.end - range.start + 1;
      if (res.ContentLength !== undefined && res.ContentLength !== want) {
        this.logger.warn(
          `range mismatch for "${key}": asked ${want}B, got ${res.ContentLength}B`,
        );
      }
    }
    return res.Body as Readable;
  }

  /**
   * The whole object as a Buffer.
   *
   * For the two consumers that need BYTES rather than a response stream: transcribing a
   * WhatsApp voice note, and re-encoding one for playback. Deliberately not used by any
   * route — a 250 MB attachment served this way would cost the whole file in heap per
   * request, which is the mistake `streamAttachmentFile` was written to avoid. Both
   * callers are bounded by WhatsApp's own 16 MB media ceiling.
   */
  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key, null);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /**
   * Remove an object. Used by the failed-upload cleanup, where no row exists yet and the
   * orphan is cheaply avoidable — NOT by soft delete, which deliberately keeps the bytes
   * because a settings row may still name the id.
   */
  async delete(key: string): Promise<void> {
    this.assertKey(key);
    await this.s3().send(
      new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }),
    );
  }

  private bucket(): string {
    if (!this.config) throw new Error('R2 is not configured');
    return this.config.bucket;
  }

  /** R2 answers a missing key with NoSuchKey on GET and a bare 404 on HEAD. */
  private isNotFound(err: unknown): boolean {
    const e = err as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      e?.$metadata?.httpStatusCode === 404 ||
      e?.name === 'NoSuchKey' ||
      e?.name === 'NotFound'
    );
  }
}
