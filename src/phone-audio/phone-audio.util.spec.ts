import { audioIdOrNone, parseDurationMs } from './phone-audio.util';

describe('audioIdOrNone', () => {
  // 0 is the "none" sentinel and MUST NOT be treated as a real id: on the per-company
  // table null already means "inherit", so none needs a different value. Getting this
  // wrong would send the resolver looking for PhoneAudio id 0, which cannot exist.
  it('treats 0 as none', () => {
    expect(audioIdOrNone(0)).toBeNull();
  });

  it('treats null and undefined as none', () => {
    expect(audioIdOrNone(null)).toBeNull();
    expect(audioIdOrNone(undefined)).toBeNull();
  });

  it('rejects negatives rather than passing them to a lookup', () => {
    expect(audioIdOrNone(-1)).toBeNull();
  });

  it('passes a real id through', () => {
    expect(audioIdOrNone(7)).toBe(7);
  });
});

describe('parseDurationMs', () => {
  // ffmpeg prints a running time= as it encodes. The LAST one is the duration; taking the
  // first would report a fraction of a second for every track.
  it('takes the last time= in the log, not the first', () => {
    const log = [
      'frame=  1 time=00:00:01.00 bitrate=N/A',
      'frame=  2 time=00:00:42.50 bitrate=N/A',
      'frame=  3 time=00:02:03.25 bitrate=N/A',
    ].join('\n');
    expect(parseDurationMs(log)).toBe(2 * 60_000 + 3 * 1000 + 250);
  });

  it('reads hours, minutes, seconds and centiseconds', () => {
    expect(parseDurationMs('time=01:02:03.04')).toBe(
      3_600_000 + 2 * 60_000 + 3_000 + 40,
    );
  });

  // ffmpeg sometimes prints a single fractional digit. "time=00:00:05.5" is 5.5s, not
  // 5.05s -- reading it as centiseconds would under-report by 10x.
  it('treats a single fractional digit as tenths', () => {
    expect(parseDurationMs('time=00:00:05.5')).toBe(5_500);
  });

  // Duration is a label in the admin UI. A log we cannot parse must not fail an upload
  // that otherwise produced a perfectly good mp3.
  it('returns 0 when there is no time= at all', () => {
    expect(parseDurationMs('Output #0, mp3, to pipe:1')).toBe(0);
    expect(parseDurationMs('')).toBe(0);
  });

  // The regex is module-level with the /g flag, so lastIndex survives between calls
  // unless it is reset. Two identical calls must agree.
  it('is not stateful across calls', () => {
    const log = 'time=00:00:01.00\ntime=00:00:09.00';
    expect(parseDurationMs(log)).toBe(9_000);
    expect(parseDurationMs(log)).toBe(9_000);
  });
});
