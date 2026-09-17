import {
  MMS_IMAGE_LADDER,
  isMmsImage,
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

describe('isMmsImage', () => {
  it('accepts the four types a carrier actually renders', () => {
    expect(isMmsImage('image/png', 'shot.png')).toBe(true);
    expect(isMmsImage('image/jpeg', 'photo.jpg')).toBe(true);
    expect(isMmsImage('image/jpeg', 'photo.jpeg')).toBe(true);
    expect(isMmsImage('image/gif', 'funny.gif')).toBe(true);
    expect(isMmsImage('image/webp', 'pic.webp')).toBe(true);
    expect(isMmsImage('IMAGE/PNG', 'SHOT.PNG')).toBe(true);
  });

  /**
   * ⚠️ Why this is not `mimetype.startsWith('image/')`, which is what the signature-logo
   * filter does. A prefix test lets HEIC through — the iPhone default — and it then fails
   * inside `sharp` and surfaces as "that picture is too large to send", which is untrue.
   */
  it('refuses image types a carrier will not render', () => {
    expect(isMmsImage('image/heic', 'IMG_0001.heic')).toBe(false);
    expect(isMmsImage('image/svg+xml', 'logo.svg')).toBe(false);
    expect(isMmsImage('image/bmp', 'old.bmp')).toBe(false);
    expect(isMmsImage('image/avif', 'new.avif')).toBe(false);
  });

  it('refuses audio, video and documents outright', () => {
    expect(isMmsImage('audio/mpeg', 'song.mp3')).toBe(false);
    expect(isMmsImage('video/mp4', 'clip.mp4')).toBe(false);
    expect(isMmsImage('application/pdf', 'invoice.pdf')).toBe(false);
    expect(isMmsImage(undefined, undefined)).toBe(false);
  });

  /** `mimetype` is client-supplied, so the filename has to corroborate it. */
  it('refuses a file whose extension contradicts its declared type', () => {
    expect(isMmsImage('image/png', 'payload.exe')).toBe(false);
    expect(isMmsImage('image/png', 'photo.jpg')).toBe(false);
    expect(isMmsImage('image/jpeg', 'clip.mp4')).toBe(false);
  });

  it('judges a file with no extension on its declared type alone', () => {
    // Nothing to disagree with — a pasted screenshot often arrives this way.
    expect(isMmsImage('image/png', 'image')).toBe(true);
  });
});
