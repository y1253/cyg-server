import { runFfmpegDetailed } from '../communications/attachment-stream.util.js';

/**
 * Pure helpers for the hold-music library. No framework, no DB, no filesystem — unit-tested
 * directly.
 */

/**
 * What every uploaded track is normalised to.
 *
 * Mono and 22.05 kHz because this is destined for a phone line, which is narrowband at the
 * far end regardless — keeping stereo would double the bytes for information the caller
 * cannot hear. `-q:a 5` is VBR around 96 kbps, comfortably transparent after the codec has
 * been through it twice.
 */
export const TELEPHONY_MP3_ARGS = [
  '-vn',
  '-ac',
  '1',
  '-ar',
  '22050',
  '-c:a',
  'libmp3lame',
  '-q:a',
  '5',
  '-f',
  'mp3',
];

/** Last `time=HH:MM:SS.xx` in ffmpeg's log — its position when it finished encoding. */
const TIME_RE = /time=(\d+):(\d{2}):(\d{2})\.(\d{1,2})/g;

export function parseDurationMs(ffmpegLog: string): number {
  let last: RegExpExecArray | null = null;
  TIME_RE.lastIndex = 0;
  for (
    let m = TIME_RE.exec(ffmpegLog);
    m !== null;
    m = TIME_RE.exec(ffmpegLog)
  ) {
    last = m;
  }
  TIME_RE.lastIndex = 0;
  if (!last) return 0;
  const [, h, m, sec, frac] = last;
  const centis = frac.length === 1 ? Number(frac) * 10 : Number(frac);
  return (
    Number(h) * 3600_000 + Number(m) * 60_000 + Number(sec) * 1000 + centis * 10
  );
}

/**
 * Transcode to mono mp3 AND measure it, in ONE ffmpeg run.
 *
 * ffmpeg reports `Duration: N/A` for input arriving on a pipe because it cannot seek to
 * find it — but it prints a running `time=` to stderr as it encodes, so the last one is the
 * duration of what it just wrote. Reading it here avoids a second full decode of the file
 * purely to measure something we already walked past.
 *
 * Duration is display sugar (a label in the admin UI), so a log we cannot parse yields 0
 * rather than failing an otherwise perfectly good upload.
 */
export async function transcodeToTelephonyMp3(
  input: Buffer,
): Promise<{ mp3: Buffer; durationMs: number }> {
  const { stdout, stderr, code } = await runFfmpegDetailed(
    input,
    TELEPHONY_MP3_ARGS,
  );
  if (code !== 0 || !stdout.length) {
    throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`);
  }
  return { mp3: stdout, durationMs: parseDurationMs(stderr) };
}

/**
 * Resolve a settings value to a usable audio id.
 *
 * `0` is the "none" sentinel on both settings tables — NULL there means "inherit", so it
 * cannot also mean "none" (see the schema docblock). Everything that reads an audio id goes
 * through here, so the sentinel is interpreted in exactly one place.
 */
export function audioIdOrNone(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}
