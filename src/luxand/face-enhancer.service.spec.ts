import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { FaceEnhancerService } from './face-enhancer.service.js';
import {
  TARGET_SIDE,
  TONE_MEAN_HIGH,
  TONE_MEAN_LOW,
  lumaStats,
  type NormalizedBox,
} from './face-image.js';

/**
 * End-to-end over real sharp, on generated images. The pure maths is covered in
 * face-image.spec.ts; what this file checks is that the two-pass pipeline is
 * wired up the way that maths assumes — the crop lands where it should, the tone
 * curve is actually applied, and nothing here can throw on the login path.
 */

function config(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => env[key],
  } as unknown as ConfigService;
}

/**
 * A synthetic "photo": coarse blocky structure at a chosen brightness and
 * contrast, plus fine grain, with a distinct square standing in for a face.
 *
 * The structure has to be COARSE. Pixel-level noise loses most of its variance to
 * the downscale, so a fixture built from noise alone measures as low-contrast by
 * the time the tone step sees it — and would make a "leaves a good photo alone"
 * test pass while the pipeline was in fact correcting it. Real photographs carry
 * their contrast at low frequencies; these fixtures have to as well.
 */
async function photo(opts: {
  width: number;
  height: number;
  mean: number;
  spread: number;
  grain?: number;
  face?: { x: number; y: number; size: number; mean: number };
}): Promise<Buffer> {
  const { width, height, mean, spread } = opts;
  const grain = opts.grain ?? 4;
  const raw = Buffer.alloc(width * height * 3);
  // A fixed LCG rather than Math.random, so a failure is reproducible.
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const BLOCK = 40;
  const cols = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const blocks = Array.from({ length: cols * rows }, () => (next() - 0.5) * 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = opts.face;
      const inFace =
        f && x >= f.x && x < f.x + f.size && y >= f.y && y < f.y + f.size;
      const base = inFace ? f.mean : mean;
      const block =
        blocks[Math.floor(y / BLOCK) * cols + Math.floor(x / BLOCK)];
      const v = Math.max(
        0,
        Math.min(255, base + block * spread + (next() - 0.5) * 2 * grain),
      );
      const i = (y * width + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function measure(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    ...lumaStats(data, info.width, info.height, info.channels),
    width: info.width,
    height: info.height,
  };
}

const BOX: NormalizedBox = { x: 0.35, y: 0.25, w: 0.3, h: 0.4 };

describe('FaceEnhancerService', () => {
  jest.setTimeout(30_000);

  it('crops and resizes to the target square when given a box', async () => {
    const service = new FaceEnhancerService(config());
    const input = await photo({
      width: 1280,
      height: 720,
      mean: 128,
      spread: 60,
    });

    const out = await service.enhance({ buffer: input }, BOX, 'login');
    const m = await measure(out.buffer);

    expect(m.width).toBe(TARGET_SIDE);
    expect(m.height).toBe(TARGET_SIDE);
    expect(out.mimeType).toBe('image/jpeg');
  });

  // The whole point of the crop: a face that was a small part of a big frame ends
  // up with far more of the JPEG's bits spent on it.
  it('shrinks the upload while enlarging the face', async () => {
    const service = new FaceEnhancerService(config());
    const input = await photo({
      width: 1280,
      height: 720,
      mean: 128,
      spread: 60,
    });

    const out = await service.enhance({ buffer: input }, BOX, 'login');

    expect(out.buffer.length).toBeLessThan(input.length);
  });

  it('brightens a dark face into the good band', async () => {
    const service = new FaceEnhancerService(config());
    const input = await photo({
      width: 1280,
      height: 720,
      mean: 45,
      spread: 25,
      face: { x: 448, y: 180, size: 288, mean: 50 },
    });

    const before = await measure(input);
    const out = await service.enhance({ buffer: input }, BOX, 'login');
    const after = await measure(out.buffer);

    expect(before.mean).toBeLessThan(TONE_MEAN_LOW);
    expect(after.mean).toBeGreaterThan(before.mean);
    expect(after.mean).toBeGreaterThanOrEqual(TONE_MEAN_LOW);
    expect(after.mean).toBeLessThanOrEqual(TONE_MEAN_HIGH);
  });

  // The guarantee that lets already-enrolled staff keep their gallery: a good
  // camera's photo must come out characteristically the same. If this ever fails,
  // the tone no-op band and the resize target disagree and the working population
  // is being changed for nothing.
  it('leaves a well-exposed face alone', async () => {
    const service = new FaceEnhancerService(config());
    const input = await photo({
      width: 1280,
      height: 720,
      mean: 130,
      spread: 95,
    });

    const before = await measure(input);
    const after = await measure(
      (await service.enhance({ buffer: input }, BOX, 'login')).buffer,
    );

    // The fixture has to actually be well exposed, or this proves nothing.
    expect(before.mean).toBeGreaterThanOrEqual(TONE_MEAN_LOW);
    expect(before.mean).toBeLessThanOrEqual(TONE_MEAN_HIGH);
    expect(after.mean).toBeCloseTo(before.mean, -1);
    // Sharpening lifts stdev slightly; a tone curve would move it a lot.
    expect(after.stdev / before.stdev).toBeGreaterThan(0.85);
    expect(after.stdev / before.stdev).toBeLessThan(1.35);
  });

  it('still resizes and tones when no box is supplied', async () => {
    const service = new FaceEnhancerService(config());
    const input = await photo({
      width: 1920,
      height: 1080,
      mean: 50,
      spread: 25,
    });

    const out = await service.enhance({ buffer: input }, null, 'login');
    const m = await measure(out.buffer);

    // Downscaled to the long-edge cap, never upscaled, aspect preserved.
    expect(m.width).toBe(1280);
    expect(m.height).toBe(720);
    expect(m.mean).toBeGreaterThan(50);
  });

  // A failure here must degrade the login, never break it.
  it('returns the original bytes rather than throwing on an undecodable photo', async () => {
    const service = new FaceEnhancerService(config());
    const junk = Buffer.from('this is not an image');

    const out = await service.enhance({ buffer: junk }, BOX, 'login');

    expect(out.buffer).toEqual(junk);
  });

  it('LUXAND_ENHANCE=0 passes the photo through untouched', async () => {
    const service = new FaceEnhancerService(config({ LUXAND_ENHANCE: '0' }));
    const input = await photo({
      width: 640,
      height: 480,
      mean: 40,
      spread: 20,
    });

    const out = await service.enhance({ buffer: input }, BOX, 'login');

    expect(out.buffer).toEqual(input);
  });

  it('LUXAND_ENHANCE_CROP=0 keeps the other four fixes but skips the crop', async () => {
    const service = new FaceEnhancerService(
      config({ LUXAND_ENHANCE_CROP: '0' }),
    );
    const input = await photo({
      width: 1280,
      height: 720,
      mean: 45,
      spread: 25,
    });

    const out = await service.enhance({ buffer: input }, BOX, 'login');
    const m = await measure(out.buffer);

    expect(m.width).toBe(1280);
    expect(m.height).toBe(720);
    expect(m.mean).toBeGreaterThan(45);
  });

  it('spends more bytes on an enrolment photo than on a login probe', async () => {
    const service = new FaceEnhancerService(config());
    const input = await photo({
      width: 1280,
      height: 720,
      mean: 128,
      spread: 60,
    });

    const login = await service.enhance({ buffer: input }, BOX, 'login');
    const enrol = await service.enhance({ buffer: input }, BOX, 'enrol');

    expect(enrol.buffer.length).toBeGreaterThan(login.buffer.length);
  });

  it('passthrough does not touch the bytes', () => {
    const service = new FaceEnhancerService(config());
    const buffer = Buffer.from([1, 2, 3]);
    expect(service.passthrough({ buffer }).buffer).toEqual(buffer);
  });
});
