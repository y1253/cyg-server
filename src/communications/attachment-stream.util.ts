import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import ffmpegPath from 'ffmpeg-static';
import * as jwt from 'jsonwebtoken';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { attachmentNameParams } from './attachment-name.util.js';

// ─── Attachment streaming helpers (shared by provider controllers) ───────────
// GmailController keeps private equivalents; the Microsoft controller uses these.

/** Only allow well-formed `type/subtype` mime strings through (prevents header injection). */
export function sanitizeMime(mime: string | undefined): string {
  return mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime)
    ? mime
    : 'application/octet-stream';
}

/** Strip characters that could break Content-Disposition (quotes, CR/LF, path seps). */
export function sanitizeFilename(name: string | undefined): string {
  return (name ?? 'attachment').replace(/["\r\n\\/]/g, '_').slice(0, 255);
}

/** Verify a JWT passed as a query param (attachment URLs used as <img>/<audio> src). */
export function verifyQueryToken(token: string | undefined): void {
  try {
    jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
  } catch {
    throw new UnauthorizedException();
  }
}

/**
 * Verify a JWT passed as a query param and return WHO it belongs to.
 *
 * `verifyQueryToken` above only checks that a token is well-formed. That is enough
 * where the resource is already scoped by something the caller cannot forge, but not
 * where the route itself has to decide whether THIS user may see it — internal
 * attachments (per-user) and the per-company SSE stream (per-assignment).
 */
export function verifyQueryTokenUser(token: string | undefined): number {
  try {
    const payload = jwt.verify(
      token ?? '',
      process.env.JWT_SECRET ?? 'secret',
    ) as { sub?: number | string };
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('bad subject');
    }
    return userId;
  } catch {
    throw new UnauthorizedException();
  }
}

/**
 * Interpret a Range header against a known entity size.
 *
 * `null` means "serve the whole thing" — no header, or one we don't understand
 * (a multi-range request falls here, and RFC 7233 lets us answer it with the
 * full entity). `'unsatisfiable'` earns a 416.
 */
function parseRange(
  range: string | undefined,
  total: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  if (total === 0) return 'unsatisfiable';

  // `bytes=-N` is a SUFFIX range — the last N bytes, not the first N. Media
  // players use it to grab an MP4's trailing moov atom before seeking, so
  // reading it as `0-N` hands them the file header and playback stalls.
  if (!match[1]) {
    const suffix = parseInt(match[2], 10);
    if (Number.isNaN(suffix) || suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }

  let start = parseInt(match[1], 10);
  let end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;
  if (start > end || start >= total) return 'unsatisfiable';
  return { start, end };
}

/**
 * The headers every attachment response carries, whatever the byte source.
 *
 * The filename goes through `attachmentNameParams`, not straight into the
 * header. HTTP header values are Latin-1, so Node's `setHeader` throws
 * `ERR_INVALID_CHAR` on any character above U+00FF — a Hebrew-named screenshot
 * used to 500 here before a single byte was written, on preview and download
 * alike. `sanitizeFilename` still runs first: it strips path separators and caps
 * the length, neither of which `attachmentNameParams` does. An ASCII name comes
 * out byte-identical to before (its `filenameParam` is empty).
 */
function setAttachmentHeaders(
  res: Response,
  mimeType: string | undefined,
  filename: string | undefined,
  disposition: string | undefined,
): void {
  const dispositionType =
    disposition === 'attachment' ? 'attachment' : 'inline';
  const { asciiName, filenameParam } = attachmentNameParams(
    sanitizeFilename(filename),
  );
  res.setHeader('Content-Type', sanitizeMime(mimeType));
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${asciiName}"${filenameParam}`,
  );
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
}

/**
 * Stream attachment bytes already in memory, honoring HTTP Range (206).
 *
 * For the provider controllers, whose bytes arrive from the Gmail/Graph API as a
 * Buffer with no file behind them. Anything sitting on our own disk should use
 * `streamAttachmentFile` instead — it never materialises the whole file.
 */
export function streamAttachment(
  res: Response,
  buf: Buffer,
  mimeType: string | undefined,
  filename: string | undefined,
  disposition: string | undefined,
  range?: string,
): void {
  setAttachmentHeaders(res, mimeType, filename, disposition);

  const total = buf.length;
  const wanted = parseRange(range, total);

  if (wanted === 'unsatisfiable') {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${total}`);
    res.end();
    return;
  }

  if (wanted) {
    const chunk = buf.subarray(wanted.start, wanted.end + 1);
    res.status(206);
    res.setHeader(
      'Content-Range',
      `bytes ${wanted.start}-${wanted.end}/${total}`,
    );
    res.setHeader('Content-Length', chunk.length);
    res.end(chunk);
    return;
  }

  res.setHeader('Content-Length', total);
  res.end(buf);
}

/**
 * Stream attachment bytes straight off disk, honoring HTTP Range (206).
 *
 * Same headers and Range semantics as `streamAttachment`, but the file is never
 * read into memory: at a 250 MB per-file cap, `readFile` would cost the whole file
 * in heap per concurrent request, and every scrub of a large video re-read all of
 * it to answer a few hundred KB.
 */
export async function streamAttachmentFile(
  res: Response,
  absolutePath: string,
  mimeType: string | undefined,
  filename: string | undefined,
  disposition: string | undefined,
  range?: string,
): Promise<void> {
  // Before any header goes out, so a row whose file has vanished still gets a
  // clean 404 through Nest's exception layer rather than a half-written response.
  let total: number;
  try {
    total = (await stat(absolutePath)).size;
  } catch {
    throw new NotFoundException('Attachment file is missing');
  }

  setAttachmentHeaders(res, mimeType, filename, disposition);

  const wanted = parseRange(range, total);

  if (wanted === 'unsatisfiable') {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${total}`);
    res.end();
    return;
  }

  if (wanted) {
    res.status(206);
    res.setHeader(
      'Content-Range',
      `bytes ${wanted.start}-${wanted.end}/${total}`,
    );
    res.setHeader('Content-Length', wanted.end - wanted.start + 1);
  } else {
    res.setHeader('Content-Length', total);
  }

  const stream = createReadStream(absolutePath, {
    start: wanted ? wanted.start : 0,
    end: wanted ? wanted.end : undefined,
  });

  // A scrubbed video abandons requests constantly; without this the descriptor
  // stays open until GC. `pipe` handles the happy path's cleanup itself.
  res.on('close', () => stream.destroy());
  stream.on('error', () => {
    // Headers are already out, so there is no status left to send — cutting the
    // socket is the only way to tell the client the body is incomplete.
    res.destroy();
  });

  stream.pipe(res);
}

/** Transcode arbitrary audio bytes to MP3 via bundled ffmpeg (for inline players). */
export async function transcodeAudioToMp3(input: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not available');
  const bin: string = ffmpegPath;
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(bin, [
      '-i',
      'pipe:0',
      '-vn',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      '-f',
      'mp3',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.stdin.on('error', () => {
      /* ignore EPIPE if ffmpeg closes stdin early */
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
