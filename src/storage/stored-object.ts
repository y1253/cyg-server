import type { Response } from 'express';
import {
  streamAttachmentFile,
  streamAttachmentStored,
} from '../communications/attachment-stream.util.js';
import { resolveStoredPath } from '../internal-messages/uploads.js';
import { localFallbackEnabled } from './storage.config.js';
import type { ObjectStorageService } from './object-storage.service.js';

export interface StoredStreamOptions {
  mimeType?: string;
  filename?: string;
  /** `'attachment'` forces a download; anything else renders inline. */
  disposition?: string;
  /** The request's raw `Range` header, if any. */
  range?: string;
  /** Overrides the default `private, max-age=3600` — only the signature logo does. */
  cacheControl?: string;
}

/**
 * Serve a stored file by its key, whichever backend currently holds it.
 *
 * The one function the four byte routes call, so "which backend, and may we fall back to
 * disk?" is decided in a single place rather than four. The key is the value already in
 * `storagePath` / `playbackPath` — `messages/<uuid>.pdf` — and is never turned into a URL.
 *
 * On `STORAGE_DRIVER=local` this is byte-identical to what the routes did before any of
 * this existed, which is what makes that setting a usable rollback for the write path.
 */
export async function streamStoredObject(
  res: Response,
  storage: ObjectStorageService,
  key: string,
  opts: StoredStreamOptions = {},
): Promise<void> {
  const { mimeType, filename, disposition, range, cacheControl } = opts;

  if (storage.driver === 'local') {
    return streamAttachmentFile(
      res,
      resolveStoredPath(key),
      mimeType,
      filename,
      disposition,
      range,
      cacheControl,
    );
  }

  // During the rollout the bytes may still be only on disk — the code deploys before the
  // migration script runs. Once that is done and verified, STORAGE_LOCAL_FALLBACK=0 turns
  // this off with an env edit, and the arm gets deleted.
  const fallbackPath = localFallbackEnabled(process.env)
    ? resolveStoredPath(key)
    : undefined;

  return streamAttachmentStored(
    res,
    storage,
    key,
    mimeType,
    filename,
    disposition,
    range,
    cacheControl,
    fallbackPath,
  );
}
