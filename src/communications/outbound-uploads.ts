import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import * as path from 'path';
import { diskStorage } from 'multer';
import { UPLOADS_ROOT } from '../internal-messages/uploads.js';

/**
 * Temp on-disk staging for OUTBOUND email attachments (Gmail + Outlook).
 *
 * Unlike internal-message attachments — which this server owns and serves for the
 * life of the message — these files are pure transit: each is read exactly once,
 * either into a MIME part or streamed up to Drive/OneDrive, and deleted straight
 * afterwards. `discardOutboundFiles` runs from a `finally`, so a failed send (or a
 * throw halfway through an upload) leaves nothing behind either.
 *
 * They land on disk rather than in memory because the cap is 250 MB per file:
 * multer's `memoryStorage` would hold every byte of a ten-file send in RAM, and
 * the Gmail MIME builder would then hold a base64 copy on top of that.
 */

/** Sub-path (relative to UPLOADS_ROOT) that in-flight attachments are staged in. */
export const OUTBOUND_SUBDIR = 'outbound';

const OUTBOUND_DIR = path.join(UPLOADS_ROOT, OUTBOUND_SUBDIR);

export const MAX_ATTACHMENTS = 10;

/** Per-file ceiling. Anything above this is rejected by multer before we see it. */
export const MAX_OUTBOUND_FILE_BYTES = 250 * 1024 * 1024;

/**
 * How many raw bytes may ride along inside the message itself.
 *
 * Base64 inflates by 4/3 plus line breaks, so ~18 MB of file becomes ~25 MB on the
 * wire — Gmail's per-message ceiling, and comfortably inside Outlook's. Whatever
 * doesn't fit is uploaded to Drive/OneDrive and linked instead, which is exactly
 * what the Gmail and Outlook web clients do with an oversized attachment.
 */
export const INLINE_BUDGET_BYTES = 18 * 1024 * 1024;

/** A multer disk-storage file as it arrives from `FilesInterceptor`. */
export interface OutboundFile {
  originalname: string;
  mimetype: string;
  size: number;
  /** Absolute path of the staged temp copy. */
  path: string;
}

export function ensureOutboundDir(): void {
  if (!existsSync(OUTBOUND_DIR)) mkdirSync(OUTBOUND_DIR, { recursive: true });
}

/**
 * Random UUID filename; the user-visible name stays in `originalname` and is only
 * ever written into a MIME header or a Drive/OneDrive item name. A hostile
 * filename therefore can't shape the path. Mirrors `messageAttachmentStorage`.
 */
export const outboundAttachmentStorage = diskStorage({
  destination: (_req, _file, cb) => {
    ensureOutboundDir();
    cb(null, OUTBOUND_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    const safeExt = /^\.[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : '';
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

export const OUTBOUND_MULTER_LIMITS = {
  fileSize: MAX_OUTBOUND_FILE_BYTES,
  // A forwarded email carries the whole quoted original in `bodyHtml`, which
  // blows past multer's 1MB default `fieldSize` and fails with an opaque
  // LIMIT_FIELD_VALUE 500 rather than anything actionable.
  fieldSize: 25 * 1024 * 1024,
};

/**
 * Split attachments into the ones that travel inside the message and the ones
 * that get uploaded and linked.
 *
 * Largest-first spill: keep moving the biggest remaining file out until the rest
 * fits `budget`. So a 1 MB PDF next to a 60 MB video sends the PDF normally and
 * links only the video, and a single file bigger than the budget always becomes a
 * link. Original order is preserved within each list, and ties break by that order
 * so the result is deterministic.
 */
export function splitBySizeBudget<T extends { size: number }>(
  files: T[],
  budget: number = INLINE_BUDGET_BYTES,
): { inline: T[]; linked: T[] } {
  const position = new Map<T, number>(files.map((f, i) => [f, i]));
  const biggestFirst = [...files].sort(
    (a, b) => b.size - a.size || position.get(a)! - position.get(b)!,
  );

  const linked = new Set<T>();
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of biggestFirst) {
    if (total <= budget) break;
    linked.add(f);
    total -= f.size;
  }

  return {
    inline: files.filter((f) => !linked.has(f)),
    linked: files.filter((f) => linked.has(f)),
  };
}

/**
 * Delete the staged temp copies. Best-effort and never throws: this runs from a
 * `finally`, so it must not mask the real send error, and a file multer never
 * finished writing may already be gone.
 */
export async function discardOutboundFiles(
  files: Array<{ path?: string }> | undefined,
): Promise<void> {
  await Promise.all(
    (files ?? []).map(async (f) => {
      if (!f?.path) return;
      try {
        await unlink(f.path);
      } catch {
        // already removed, or never fully written
      }
    }),
  );
}

/**
 * Sweep anything the normal path couldn't delete: a multer abort partway through
 * a 250 MB upload (the request never reaches the service, so no `finally` runs),
 * or a process restart mid-send. Nothing here is ever needed again — the staging
 * dir should be empty between sends — so age alone is a safe criterion.
 *
 * Returns how many files it removed. Never throws: it runs from a cron.
 */
export async function sweepStaleOutboundFiles(
  maxAgeMs = 60 * 60 * 1000,
): Promise<number> {
  let removed = 0;
  try {
    const names = await readdir(OUTBOUND_DIR);
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
      const full = path.join(OUTBOUND_DIR, name);
      try {
        const info = await stat(full);
        if (info.isFile() && info.mtimeMs < cutoff) {
          await unlink(full);
          removed++;
        }
      } catch {
        // raced with a real send, or vanished — either way, not our problem
      }
    }
  } catch {
    // directory doesn't exist yet: nothing has ever been staged
  }
  return removed;
}
