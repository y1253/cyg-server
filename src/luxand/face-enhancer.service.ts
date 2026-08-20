import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  cropRect,
  jpegQuality,
  lumaStats,
  needsDenoise,
  noBoxResize,
  resizeKernel,
  sharpenParams,
  targetSide,
  toneAdjustment,
  type CropRect,
  type EnhancedPhoto,
  type NormalizedBox,
  type PhotoMode,
  type RawPhoto,
} from './face-image.js';

/**
 * The five fixes applied to a photo on its way to Luxand: crop to the face,
 * resize to a consistent scale, correct exposure and contrast, denoise, sharpen.
 *
 * Applied to **both** the enrolment photos and the login probe, from one set of
 * constants. That is the point rather than a detail: recognition works by
 * comparing a probe against a gallery, so enhancing only one side would widen the
 * very gap this exists to close. (Before this, enrolment was histogram-normalised
 * and login was not — a gap every single login paid for.)
 *
 * The one photo that must NOT come through here is the liveness frame. See
 * `LuxandService.liveness`.
 */
@Injectable()
export class FaceEnhancerService {
  private readonly logger = new Logger(FaceEnhancerService.name);
  private readonly enabled: boolean;
  private readonly cropEnabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('LUXAND_ENHANCE') !== '0';
    // Isolates the crop specifically. If one user regresses, this answers
    // "was it the crop?" without giving up the other four fixes.
    this.cropEnabled = config.get<string>('LUXAND_ENHANCE_CROP') !== '0';
  }

  /**
   * Send a photo down the matching path without enhancing it.
   *
   * The brand exists to keep enhanced pixels out of *liveness*, not to keep raw
   * pixels out of verify or createPerson — a raw photo there is merely the old
   * behaviour. This is the same operation `enhance` performs when the kill-switch
   * is off, named so the two callers that want it on purpose (the kill-switch and
   * enrolment's retry-on-rejection) do not each invent their own cast.
   */
  passthrough(photo: RawPhoto): EnhancedPhoto {
    return brand(photo);
  }

  /**
   * Never throws and never rejects. Any failure — a truncated upload, an
   * unexpected colourspace, a crop sharp refuses — falls back to the original
   * bytes with a warning. A degraded login beats a 500 on the login screen.
   */
  async enhance(
    photo: RawPhoto,
    box: NormalizedBox | null,
    mode: PhotoMode,
  ): Promise<EnhancedPhoto> {
    if (!this.enabled) return brand(photo);

    const started = Date.now();
    try {
      const result = await this.run(photo, box, mode);
      this.logger.log(
        `face-enhance ${mode} box=${result.cropped ? 'y' : 'n'} ` +
          `${photo.buffer.length}->${result.photo.buffer.length}B ${Date.now() - started}ms`,
      );
      this.logger.debug(`face-enhance ${mode} ${result.detail}`);
      return result.photo;
    } catch (err) {
      this.logger.warn(
        `face-enhance ${mode} FAILED after ${Date.now() - started}ms, sending original: ${String(err)}`,
      );
      return brand(photo);
    }
  }

  private async run(
    photo: RawPhoto,
    box: NormalizedBox | null,
    mode: PhotoMode,
  ): Promise<{ photo: EnhancedPhoto; cropped: boolean; detail: string }> {
    const { width, height } = await displaySize(photo.buffer);

    const rect = box && this.cropEnabled ? cropRect(box, width, height) : null;

    // Pass 1: decode once, orient, crop, resize, and hand the pixels over raw.
    //
    // The alternative — one pipeline plus `.stats()` — costs a second full decode
    // AND measures the whole frame, which gets the backlit case exactly backwards:
    // a bright window behind a dark face reads as "not dark", so the face stays a
    // silhouette. Measuring the crop is the entire reason for the split.
    let pass1 = sharp(photo.buffer, { failOn: 'none' }).rotate();
    let upscaled = false;

    if (rect) {
      const target = targetSide(rect.width);
      upscaled = target.upscaled;
      pass1 = pass1.extract(rect).resize({
        width: target.side,
        height: target.side,
        kernel: resizeKernel(target.upscaled),
        fit: 'fill',
      });
    } else {
      const shrink = noBoxResize(width, height);
      if (shrink) {
        pass1 = pass1.resize({ ...shrink, kernel: 'lanczos3', fit: 'fill' });
      }
    }

    const { data, info } = await pass1
      .toColorspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // With a crop, every pixel is face and context. Without one, the centre is
    // the only honest guess at where the face is.
    const stats = lumaStats(
      data,
      info.width,
      info.height,
      info.channels,
      rect ? 'all' : 'center',
    );
    const tone = toneAdjustment(stats);
    const denoise = needsDenoise(stats, tone);
    const sharpen = sharpenParams(upscaled);

    // Pass 2: tone, then denoise, then sharpen — in that order. Sharpening before
    // denoising would sharpen the grain and then smear the result.
    let pass2 = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });
    if (tone) pass2 = pass2.linear(tone.a, tone.b);
    if (denoise) pass2 = pass2.median(3);

    const buffer = await pass2
      .sharpen(sharpen)
      // Set explicitly rather than relying on sharp's implicit quality>=90
      // behaviour: 4:2:0 halves chroma resolution, which on a 576px face wrecks
      // the lid margin, iris boundary and lip line.
      .jpeg({
        quality: jpegQuality(mode),
        chromaSubsampling: '4:4:4',
        mozjpeg: false,
      })
      .toBuffer();

    return {
      photo: brand({ buffer, mimeType: 'image/jpeg' }),
      cropped: rect !== null,
      detail: describe(rect, info.width, stats, tone, denoise, upscaled),
    };
  }
}

/**
 * The only place an EnhancedPhoto is minted. Keeping the cast here is what makes
 * the brand meaningful — see the type's doc comment.
 */
function brand(photo: RawPhoto): EnhancedPhoto {
  return { buffer: photo.buffer, mimeType: photo.mimeType } as EnhancedPhoto;
}

/**
 * Image dimensions as displayed, not as stored.
 *
 * EXIF orientations 5-8 swap width and height relative to `metadata()`, and the
 * client's box fractions are in display space. Canvas-produced JPEGs carry no
 * EXIF so this is a no-op today — it is here so the first phone photo anyone
 * uploads does not crop a rectangle from the wrong axis.
 */
async function displaySize(
  buffer: Buffer,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped ? { width: height, height: width } : { width, height };
}

function describe(
  rect: CropRect | null,
  side: number,
  stats: { mean: number; stdev: number },
  tone: { a: number; b: number } | null,
  denoise: boolean,
  upscaled: boolean,
): string {
  const crop = rect ? `${rect.width}px@${rect.left},${rect.top}` : 'none';
  const curve = tone ? `a=${tone.a.toFixed(2)} b=${tone.b.toFixed(1)}` : 'none';
  return (
    `crop=${crop} side=${side} up=${upscaled ? 'y' : 'n'} ` +
    `mean=${stats.mean.toFixed(1)} stdev=${stats.stdev.toFixed(1)} ` +
    `tone=${curve} denoise=${denoise ? 'y' : 'n'}`
  );
}
