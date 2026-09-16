import { existsSync, mkdirSync } from 'fs';
import { readdir, rm, stat } from 'fs/promises';
import * as path from 'path';
import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { UPLOADS_ROOT } from '../internal-messages/uploads.js';

/**
 * Staging for OUTBOUND picture and audio messages.
 *
 * ── WHY THESE FILES HAVE TO BE PUBLICLY REACHABLE AT ALL ───────────────────────
 * The Compatibility API takes an attachment as a `MediaUrl` that SIGNALWIRE FETCHES over
 * the public internet — there is no upload endpoint to post bytes to. So unlike every other
 * file this application handles, these are served to a stranger's HTTP client with no
 * session, the same predicament `SignatureImagePublicController` documents.
 *
 * It is not the same risk, though, and the settings differ accordingly. A signature logo is
 * a firm asset designed to be mailed to strangers, cached for a day and left in place. This
 * is a CLIENT'S DOCUMENT, so:
 *
 *  - the URL carries a token bound to the one file, not just an unguessable name;
 *  - that token lives MINUTES, not the recording token's hour — SignalWire fetches within
 *    seconds of the POST, and nothing else ever needs it;
 *  - the file is removed within the hour, and at once if the send fails;
 *  - and the route sends `no-store`, where the logo deliberately sends `public`.
 */

/** Sub-path of UPLOADS_ROOT that in-flight MMS attachments are staged in. */
export const MMS_SUBDIR = 'mms';

export const MMS_DIR = path.join(UPLOADS_ROOT, MMS_SUBDIR);

/**
 * How many files may ride on one text.
 *
 * The wire allows ten. Three is what a person actually attaches, and every extra file is
 * another carrier-side chance for the whole message to be rejected rather than degraded.
 */
export const MAX_MMS_FILES = 3;

/**
 * What a carrier will actually deliver, after our own re-encoding.
 *
 * ⚠️ These are not provider limits, they are CARRIER limits, and they are the reason the
 * send path shrinks rather than rejects. SignalWire accepts up to ~5 MB; a large fraction
 * of North American carriers silently drop or brutally re-compress anything much over 1 MB,
 * and "silently drop" is the failure mode this whole budget exists to avoid — a message
 * that reports `sent` and never arrives.
 */
export const MAX_MMS_TOTAL_BYTES = 1024 * 1024;

/** The largest single file, before shrinking. Anything above this is refused outright. */
export const MAX_MMS_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A staged file is useless once its send has finished; this is only a backstop. */
export const MMS_STALE_MS = 6 * 60 * 60 * 1000;

/** Minutes, not hours — see the docblock above. */
const TOKEN_TTL_SECONDS = 15 * 60;

export function ensureMmsDir(): void {
  if (!existsSync(MMS_DIR)) mkdirSync(MMS_DIR, { recursive: true });
}

/**
 * A token naming exactly one staged file.
 *
 * The filename is a UUID, so this is belt and braces — but the braces matter here: an
 * unguessable name is not access control (the argument `recording-token.util.ts` makes),
 * and this directory holds client documents on a route with no session behind it.
 */
export function signMmsToken(filename: string): string {
  return jwt.sign({ mms: filename }, process.env.JWT_SECRET ?? 'secret', {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function assertMmsToken(
  token: string | undefined,
  filename: string,
): void {
  let payload: { mms?: unknown };
  try {
    payload = jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret') as {
      mms?: unknown;
    };
  } catch {
    throw new UnauthorizedException();
  }
  if (payload.mms !== filename) throw new UnauthorizedException();
}

/**
 * Resolve a staged filename to a path inside the staging directory.
 *
 * The name arrives in a URL, so it is treated as hostile: a single path segment of the
 * shape we mint, and nothing else. `resolveStoredPath`'s traversal guard is the same idea;
 * this one is narrower because there is only ever one legal shape here.
 */
export function resolveStagedMms(filename: string): string | null {
  if (!/^[0-9a-f-]{36}(\.[A-Za-z0-9]{1,12})?$/.test(filename)) return null;
  const absolute = path.join(MMS_DIR, filename);
  return path.resolve(absolute).startsWith(path.resolve(MMS_DIR))
    ? absolute
    : null;
}

/** Delete staged files, never throwing — this runs from a `finally`. */
export async function discardStagedMms(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((p) => rm(p, { force: true }).catch(() => undefined)),
  );
}

/**
 * Backstop sweep, mirroring `sweepStaleOutboundFiles`.
 *
 * The send path deletes its own files, so this normally finds nothing. It exists for the
 * cases that never reach a service method: multer aborting a too-large upload partway
 * through, and a restart mid-send.
 */
export async function sweepStaleMmsFiles(
  maxAgeMs: number = MMS_STALE_MS,
): Promise<number> {
  if (!existsSync(MMS_DIR)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of await readdir(MMS_DIR).catch(() => [])) {
    const absolute = path.join(MMS_DIR, name);
    try {
      const info = await stat(absolute);
      if (info.mtimeMs < cutoff) {
        await rm(absolute, { force: true });
        removed++;
      }
    } catch {
      // A file that vanished underneath us is exactly what this is for.
    }
  }
  return removed;
}
