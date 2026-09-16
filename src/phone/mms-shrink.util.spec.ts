import {
  MMS_AUDIO_ARGS,
  MMS_IMAGE_LADDER,
  mmsMediaClass,
  perFileBudget,
} from './mms-shrink.util';

describe('perFileBudget', () => {
  /**
   * The carrier's ceiling applies to the MESSAGE. Three photos each just inside a per-file
   * limit would make a message three times over it — which is exactly the mistake a
   * per-file constant looks like it prevents.
   */
  it('splits the message budget between the files, never per file', () => {
    expect(perFileBudget(900_000, 1)).toBe(900_000);
    expect(perFileBudget(900_000, 3)).toBe(300_000);
  });

  it('never returns zero, whatever it is asked', () => {
    expect(perFileBudget(1, 10)).toBe(1);
    expect(perFileBudget(0, 0)).toBe(1);
  });
});

describe('MMS_IMAGE_LADDER', () => {
  it('gets strictly smaller and harsher at every rung', () => {
    for (let i = 1; i < MMS_IMAGE_LADDER.length; i++) {
      expect(MMS_IMAGE_LADDER[i].edge).toBeLessThan(MMS_IMAGE_LADDER[i - 1].edge);
      expect(MMS_IMAGE_LADDER[i].quality).toBeLessThan(
        MMS_IMAGE_LADDER[i - 1].quality,
      );
    }
  });

  it('starts at a size a phone photo still looks like a photo at', () => {
    expect(MMS_IMAGE_LADDER[0].edge).toBeGreaterThanOrEqual(1280);
  });
});

describe('MMS_AUDIO_ARGS', () => {
  /**
   * Its own constant on purpose. Sharing `TELEPHONY_MP3_ARGS` and retuning it for this
   * caller is how the hold-music player silently breaks.
   */
  it('is telephone-grade mono, which is what fits a text message', () => {
    expect(MMS_AUDIO_ARGS).toContain('-ac');
    expect(MMS_AUDIO_ARGS[MMS_AUDIO_ARGS.indexOf('-ac') + 1]).toBe('1');
    expect(MMS_AUDIO_ARGS[MMS_AUDIO_ARGS.indexOf('-b:a') + 1]).toBe('32k');
  });
});

describe('mmsMediaClass', () => {
  it('recognises what can be re-encoded smaller', () => {
    expect(mmsMediaClass('image/jpeg')).toBe('image');
    expect(mmsMediaClass('IMAGE/PNG')).toBe('image');
    expect(mmsMediaClass('audio/ogg; codecs=opus')).toBe('audio');
    expect(mmsMediaClass('video/mp4')).toBe('other');
    expect(mmsMediaClass(undefined)).toBe('other');
  });
});
