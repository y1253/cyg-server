/**
 * Does the enhancement pass actually help? The acceptance table.
 *
 * Degrades one good photo six ways in-process, then asks Luxand to verify each
 * variant twice — once as captured, once through the real FaceEnhancerService —
 * and prints the two probabilities side by side. No bad webcam required.
 *
 *   cd server
 *   npx tsx --env-file=.env scripts/face-enhance-probe.ts good1 good2 good3 probe --box='{"x":..,"y":..,"w":..,"h":..}'
 *
 *   --dry-run builds every variant and times the enhancer, no API calls
 *   good1..3  three photos of ONE person (straight / right / left) -> enrolled
 *   probe     a FOURTH photo of that same person, well exposed     -> degraded below
 *
 * Imports the service rather than reimplementing the pipeline, so this cannot
 * drift from what production does.
 *
 * Acceptance, decided before running:
 *   - prob_enh >= prob_raw on EVERY degraded variant
 *   - prob_enh >= prob_raw - 0.02 on `clean` — the do-no-harm gate for the people
 *     whose camera is already fine. If this fails, the tone no-op band or the
 *     resize target is wrong and the constants need retuning, not shipping.
 *   - enh_ms p95 under 60ms
 *   - bytes_enh < bytes_raw everywhere
 *
 * Creates one throwaway Luxand person and deletes it again.
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { FaceEnhancerService } from '../src/luxand/face-enhancer.service.js';
import {
  lumaStats,
  parseFaceBox,
  type NormalizedBox,
} from '../src/luxand/face-image.js';

const TOKEN = process.env.LUXAND_API_KEY;
if (!TOKEN) {
  console.error('LUXAND_API_KEY missing from server/.env');
  process.exit(1);
}
/** Narrowed once here; TS does not follow process.exit(). */
const token: string = TOKEN;

const BASE = 'https://api.luxand.cloud';
const argv = process.argv.slice(2);
/**
 * Build every variant and run the real enhancer over it, but make no API calls.
 *
 * Checks the half of this script that can be wrong without Luxand's help: that
 * each degradation recipe produces the image it claims to, and that the
 * enhancement lands within its time budget. Costs nothing, so run it before
 * spending calls on the full table.
 */
const dryRun = argv.includes('--dry-run');
// Named rather than positional: with --dry-run taking a single photo, a trailing
// positional box silently became the second filename instead, and the whole table
// ran the no-box path while claiming otherwise.
const boxJson = argv.find((a) => a.startsWith('--box='))?.slice('--box='.length);
const [g1, g2, g3, probePath] = argv.filter((a) => !a.startsWith('--'));
if (dryRun ? !g1 : !g1 || !g2 || !g3 || !probePath) {
  console.error(
    'Need 4 photos: good1 good2 good3 probe\n' +
      '  --dry-run    build the variants and time the enhancer, no API calls;\n' +
      '               needs only the first photo\n' +
      '  --box=JSON   the face rectangle, e.g.\n' +
      '                 --box=\'{"x":0.35,"y":0.2,"w":0.3,"h":0.4}\'\n' +
      '               Without it the probe runs the no-box path, which is worth\n' +
      '               measuring on its own but does NOT exercise the crop.',
  );
  process.exit(1);
}

const blob = (buf: Buffer) =>
  new Blob([new Uint8Array(buf)], { type: 'image/jpeg' });

async function call(path: string, photo: Buffer): Promise<unknown> {
  const form = new FormData();
  form.append('photo', blob(photo), 'photo.jpg');
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { token },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  return JSON.parse(await res.text());
}

/** Luxand reports most failures as HTTP 200, so dig the score out defensively. */
function scoreOf(data: unknown): number | null {
  const seen = JSON.stringify(data);
  for (const key of ['probability', 'score', 'confidence', 'similarity']) {
    const m = seen.match(new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`));
    if (m) {
      const n = Number(m[1]);
      return n > 1 ? n / 100 : n;
    }
  }
  return null;
}

// ── The bad-camera corpus ────────────────────────────────────────────────────
// Every recipe is a plausible failure of a cheap sensor in a real office, not an
// arbitrary distortion.

type Variant = { name: string; make: (src: Buffer) => Promise<Buffer> };

const VARIANTS: Variant[] = [
  { name: 'clean', make: async (b) => b },
  {
    name: 'dark',
    make: (b) => sharp(b).linear(0.45, -20).jpeg({ quality: 92 }).toBuffer(),
  },
  {
    name: 'flat',
    make: (b) => sharp(b).linear(0.35, 70).jpeg({ quality: 92 }).toBuffer(),
  },
  {
    name: 'backlit',
    make: async (b) => {
      // Bright surround, dark subject — the case whole-frame statistics get wrong.
      const { width = 1280, height = 720 } = await sharp(b).metadata();
      const glow = await sharp({
        create: {
          width,
          height: Math.round(height * 0.5),
          channels: 3,
          background: { r: 255, g: 255, b: 250 },
        },
      })
        .png()
        .toBuffer();
      return sharp(b)
        .linear(0.6, -10)
        .composite([{ input: glow, top: 0, left: 0, blend: 'screen' }])
        .jpeg({ quality: 92 })
        .toBuffer();
    },
  },
  {
    name: 'smallface',
    make: async (b) => {
      // A 640x480-class sensor: throw the pixels away, then stretch back so the
      // frame size is unchanged and only the detail is gone.
      const { width = 1280, height = 720 } = await sharp(b).metadata();
      const small = await sharp(b)
        .resize(320, 240, { kernel: 'nearest', fit: 'fill' })
        .toBuffer();
      return sharp(small)
        .resize(width, height, { kernel: 'nearest', fit: 'fill' })
        .jpeg({ quality: 92 })
        .toBuffer();
    },
  },
  {
    name: 'grainy',
    make: async (b) => {
      const { width = 1280, height = 720 } = await sharp(b).metadata();
      const noise = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: 'gaussian', mean: 128, sigma: 18 },
        },
      })
        .png()
        .toBuffer();
      return sharp(b)
        .composite([{ input: noise, blend: 'overlay' }])
        .jpeg({ quality: 92 })
        .toBuffer();
    },
  },
  {
    name: 'badcodec',
    make: (b) => sharp(b).jpeg({ quality: 25 }).toBuffer(),
  },
  {
    name: 'combo',
    make: async (b) => {
      // The employee who actually complained.
      const { width = 1280, height = 720 } = await sharp(b).metadata();
      const small = await sharp(b)
        .resize(320, 240, { kernel: 'nearest', fit: 'fill' })
        .toBuffer();
      const noise = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: 'gaussian', mean: 128, sigma: 18 },
        },
      })
        .png()
        .toBuffer();
      return sharp(small)
        .resize(width, height, { kernel: 'nearest', fit: 'fill' })
        .linear(0.45, -20)
        .composite([{ input: noise, blend: 'overlay' }])
        .jpeg({ quality: 92 })
        .toBuffer();
    },
  },
];

// ── Run ──────────────────────────────────────────────────────────────────────

// The real service, reading the real env, so the probe cannot measure something
// production does not do.
const enhancer = new FaceEnhancerService({
  get: (key: string) => process.env[key],
  getOrThrow: (key: string) => process.env[key],
} as never);

const box: NormalizedBox | null = parseFaceBox(boxJson);
if (boxJson && !box) {
  console.error(`faceBox "${boxJson}" is not a usable box; running without one.`);
}

async function main() {
  if (dryRun) {
    await dryRunTable(await readFile(g1));
    return;
  }

  const gallery = await Promise.all([g1, g2, g3].map((p) => readFile(p)));
  const probe = await readFile(probePath);

  console.log('Enrolling a throwaway person from the three good photos...');
  const enrolForm = new FormData();
  enrolForm.append('name', `enhance-probe ${process.pid}`);
  enrolForm.append('store', '1');
  for (const photo of gallery) {
    // The gallery goes through the same pipeline production uses, because that is
    // what production will be comparing against.
    const enhanced = await enhancer.enhance({ buffer: photo }, box, 'enrol');
    enrolForm.append('photos', blob(enhanced.buffer), 'photo.jpg');
  }
  const created = (await (
    await fetch(`${BASE}/v2/person`, {
      method: 'POST',
      headers: { token },
      body: enrolForm,
      signal: AbortSignal.timeout(60_000),
    })
  ).json()) as Record<string, string>;

  const uuid = created.uuid ?? created.id;
  if (!uuid) {
    console.error('Enrolment failed:', created);
    process.exit(1);
  }
  console.log(`person ${uuid}\n`);

  const rows: string[] = [];
  const timings: number[] = [];
  let failures = 0;

  console.log(
    'variant     prob_raw  prob_enh   delta    bytes_raw  bytes_enh  enh_ms',
  );

  try {
    for (const variant of VARIANTS) {
      const degraded = await variant.make(probe);

      const started = Date.now();
      const enhanced = await enhancer.enhance({ buffer: degraded }, box, 'login');
      const enhMs = Date.now() - started;
      timings.push(enhMs);

      const rawScore = scoreOf(await call(`/photo/verify/${uuid}`, degraded));
      const enhScore = scoreOf(
        await call(`/photo/verify/${uuid}`, enhanced.buffer),
      );

      const delta =
        rawScore !== null && enhScore !== null ? enhScore - rawScore : null;

      // The acceptance rule differs for `clean`: there we only require that we did
      // no harm, because there was nothing to fix.
      const ok =
        delta === null
          ? false
          : variant.name === 'clean'
            ? delta >= -0.02
            : delta >= 0;
      if (!ok) failures++;

      const f = (n: number | null) => (n === null ? '   --  ' : n.toFixed(2).padStart(7));
      const kb = (n: number) => `${Math.round(n / 1024)}k`.padStart(9);
      rows.push(
        `${variant.name.padEnd(11)}${f(rawScore)}  ${f(enhScore)}  ` +
          `${delta === null ? '  --  ' : (delta >= 0 ? '+' : '') + delta.toFixed(2)}`.padEnd(
            9,
          ) +
          `${kb(degraded.length)} ${kb(enhanced.buffer.length)}  ` +
          `${String(enhMs).padStart(5)}  ${ok ? '' : '<-- FAIL'}`,
      );
      console.log(rows[rows.length - 1]);
    }
  } finally {
    await fetch(`${BASE}/v2/person/${uuid}`, {
      method: 'DELETE',
      headers: { token },
    }).catch(() => undefined);
    console.log(`\nDeleted throwaway person ${uuid}.`);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  console.log(`enhance p95: ${p95}ms  (budget 60ms)`);
  console.log(box ? 'crop: enabled' : 'crop: no box supplied — no-box path');
  console.log(
    failures === 0
      ? '\nPASS — every variant met the acceptance rule.'
      : `\nFAIL — ${failures} variant(s) missed the acceptance rule. Retune the constants in face-image.ts rather than shipping.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** Offline half of the probe: recipes and timings only, no Luxand. */
async function dryRunTable(source: Buffer) {
  const measure = async (buf: Buffer) => {
    const { data, info } = await sharp(buf)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { mean, stdev } = lumaStats(
      data,
      info.width,
      info.height,
      info.channels,
    );
    return { mean, stdev, w: info.width, h: info.height };
  };

  console.log(
    'variant      in_mean in_sd   out_mean out_sd  in_px       out_px     bytes         ms',
  );
  const timings: number[] = [];

  for (const variant of VARIANTS) {
    const degraded = await variant.make(source);
    const before = await measure(degraded);

    const started = Date.now();
    const enhanced = await enhancer.enhance({ buffer: degraded }, box, 'login');
    const ms = Date.now() - started;
    timings.push(ms);

    const after = await measure(enhanced.buffer);
    const n = (v: number) => v.toFixed(1).padStart(7);
    console.log(
      `${variant.name.padEnd(12)}${n(before.mean)} ${n(before.stdev)} ` +
        `${n(after.mean)}  ${n(after.stdev)}  ` +
        `${`${before.w}x${before.h}`.padEnd(11)} ${`${after.w}x${after.h}`.padEnd(10)} ` +
        `${`${Math.round(degraded.length / 1024)}k->${Math.round(enhanced.buffer.length / 1024)}k`.padEnd(12)} ` +
        `${String(ms).padStart(4)}`,
    );
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  console.log(`\nenhance p95: ${p95}ms  (budget 60ms)`);
  console.log(box ? 'crop: enabled' : 'crop: no box supplied — no-box path');
  console.log('\nDry run: no Luxand calls made, no probabilities measured.');
}

void main();
