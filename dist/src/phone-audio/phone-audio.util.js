"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TELEPHONY_MP3_ARGS = void 0;
exports.parseDurationMs = parseDurationMs;
exports.transcodeToTelephonyMp3 = transcodeToTelephonyMp3;
exports.audioIdOrNone = audioIdOrNone;
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
exports.TELEPHONY_MP3_ARGS = [
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
const TIME_RE = /time=(\d+):(\d{2}):(\d{2})\.(\d{1,2})/g;
function parseDurationMs(ffmpegLog) {
    let last = null;
    TIME_RE.lastIndex = 0;
    for (let m = TIME_RE.exec(ffmpegLog); m !== null; m = TIME_RE.exec(ffmpegLog)) {
        last = m;
    }
    TIME_RE.lastIndex = 0;
    if (!last)
        return 0;
    const [, h, m, sec, frac] = last;
    const centis = frac.length === 1 ? Number(frac) * 10 : Number(frac);
    return (Number(h) * 3600_000 + Number(m) * 60_000 + Number(sec) * 1000 + centis * 10);
}
async function transcodeToTelephonyMp3(input) {
    const { stdout, stderr, code } = await (0, attachment_stream_util_js_1.runFfmpegDetailed)(input, exports.TELEPHONY_MP3_ARGS);
    if (code !== 0 || !stdout.length) {
        throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`);
    }
    return { mp3: stdout, durationMs: parseDurationMs(stderr) };
}
function audioIdOrNone(value) {
    return typeof value === 'number' && value > 0 ? value : null;
}
//# sourceMappingURL=phone-audio.util.js.map