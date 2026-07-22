import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';

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

/** Stream attachment bytes with the right headers, honoring HTTP Range (206). */
export function streamAttachment(
  res: Response,
  buf: Buffer,
  mimeType: string | undefined,
  filename: string | undefined,
  disposition: string | undefined,
  range?: string,
): void {
  const dispositionType =
    disposition === 'attachment' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', sanitizeMime(mimeType));
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${sanitizeFilename(filename)}"`,
  );
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const total = buf.length;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }
    const chunk = buf.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', chunk.length);
    res.end(chunk);
    return;
  }

  res.setHeader('Content-Length', total);
  res.end(buf);
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
