import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  describeLuxandError,
  extractId,
  extractScore,
  failureMessage,
  isFailureEnvelope,
  normalizeScore,
  type LuxandJson,
} from './luxand-parse.js';

export interface PhotoInput {
  buffer: Buffer;
  mimeType?: string;
}

export interface LuxandVerifyResult {
  matched: boolean;
  probability: number | null;
}

export interface LuxandMatch {
  uuid: string;
  probability: number;
}

export interface LuxandLiveness {
  live: boolean;
  score: number | null;
}

/**
 * Per-call ceilings. Verify sits on the login path, so it gets the tightest one:
 * a fast error beats a spinner that never resolves.
 */
const TIMEOUTS = {
  createPerson: 20_000,
  addPhoto: 10_000,
  verify: 8_000,
  liveness: 8_000,
  search: 12_000,
  deletePerson: 5_000,
} as const;

@Injectable()
export class LuxandService {
  private readonly logger = new Logger(LuxandService.name);
  private readonly baseUrl = 'https://api.luxand.cloud';
  private readonly apiKey: string;
  private readonly searchMinConfidence: number;
  private readonly verifyMinConfidence: number;
  private readonly livenessMin: number;
  private readonly timeoutOverride: number | null;
  private readonly preprocessLogin: boolean;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('LUXAND_API_KEY');
    this.searchMinConfidence = parseFloat(
      config.get<string>('LUXAND_MIN_CONFIDENCE') ?? '0.75',
    );
    this.verifyMinConfidence = parseFloat(
      config.get<string>('LUXAND_VERIFY_MIN_CONFIDENCE') ?? '0.75',
    );
    this.livenessMin = parseFloat(
      config.get<string>('LUXAND_LIVENESS_MIN') ?? '0.5',
    );
    const timeout = config.get<string>('LUXAND_TIMEOUT_MS');
    this.timeoutOverride = timeout ? parseInt(timeout, 10) : null;
    this.preprocessLogin =
      config.get<string>('LUXAND_PREPROCESS_LOGIN') === '1';
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

  /**
   * Every Luxand call goes through here, so timing, timeouts and error mapping
   * cannot drift apart between methods.
   *
   * Two properties of this API make a shared helper necessary rather than merely
   * tidy:
   *
   * 1. Luxand reports most failures as **HTTP 200** with a `{"status":"failure"}`
   *    body, so `res.ok` on its own is not an error check. It also returns a bare
   *    500 for some malformed requests, so the status code alone is not one
   *    either. Both are checked here, in one place.
   * 2. Nothing else in this path was instrumented, which is why "face login is
   *    slow" was never attributable to a stage. Every call logs its elapsed ms.
   */
  private async call(
    label: string,
    path: string,
    init: { method: 'POST' | 'DELETE'; form?: FormData; timeoutMs: number },
  ): Promise<LuxandJson> {
    const started = Date.now();
    let res: Response;

    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        // No Content-Type header: fetch owns the multipart boundary.
        headers: { token: this.apiKey },
        ...(init.form ? { body: init.form } : {}),
        signal: AbortSignal.timeout(this.timeoutOverride ?? init.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      this.logger.error(`${label} FAILED ${name} ${Date.now() - started}ms`);
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new BadGatewayException('Face service timed out');
      }
      throw new BadGatewayException('Face service unreachable');
    }

    const raw = await res.text();
    this.logger.log(`${label} ${res.status} ${Date.now() - started}ms`);

    let data: LuxandJson = null;
    try {
      data = JSON.parse(raw) as LuxandJson;
    } catch {
      // Leave data null — a non-JSON body is itself a failure, reported raw below.
    }

    if (!res.ok || isFailureEnvelope(data)) {
      const message = failureMessage(data, raw);
      this.logger.warn(`${label} rejected: ${message.slice(0, 300)}`);
      throw new BadGatewayException(describeLuxandError(message));
    }

    return data;
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  /**
   * Histogram stretch, so the stored gallery is lighting-consistent regardless of
   * which room the photos were taken in.
   */
  private async preprocess(buffer: Buffer): Promise<Buffer> {
    const started = Date.now();
    const out = await sharp(buffer)
      .normalize()
      .jpeg({ quality: 92 })
      .toBuffer();
    this.logger.debug(`sharp normalize ${Date.now() - started}ms`);
    return out;
  }

  private async appendPhoto(
    form: FormData,
    field: string,
    photo: PhotoInput,
    normalize: boolean,
  ): Promise<void> {
    const buffer = normalize
      ? await this.preprocess(photo.buffer)
      : photo.buffer;
    form.append(
      field,
      new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }),
      'photo.jpg',
    );
  }

  // ── API ─────────────────────────────────────────────────────────────────────

  /**
   * Create one Luxand person holding every enrolment photo, in a single request.
   *
   * The field is `photos` — plural and repeatable. Sending `photo` here returns a
   * bare HTTP 500. Enrolment happens once and is not latency-sensitive, so the
   * photos are normalised on the way in: this is the gallery every later login is
   * compared against, which is exactly where the histogram stretch pays off.
   */
  async createPerson(name: string, photos: PhotoInput[]): Promise<string> {
    const form = new FormData();
    form.append('name', name);
    form.append('store', '1');
    for (const photo of photos) {
      await this.appendPhoto(form, 'photos', photo, true);
    }

    const data = await this.call('createPerson', '/v2/person', {
      method: 'POST',
      form,
      timeoutMs: TIMEOUTS.createPerson,
    });

    const id = extractId(data);
    if (!id) {
      throw new BadGatewayException(
        `Luxand create response missing person id: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    return id;
  }

  /** Add another photo to an existing person. The field is `photo` here, singular. */
  async addPhoto(uuid: string, photo: PhotoInput): Promise<void> {
    const form = new FormData();
    await this.appendPhoto(form, 'photo', photo, true);
    form.append('store', '1');

    await this.call('addPhoto', `/v2/person/${uuid}`, {
      method: 'POST',
      form,
      timeoutMs: TIMEOUTS.addPhoto,
    });
  }

  /**
   * 1:1 — "is this that specific person?"
   *
   * This is the point of the rework. The login flow already knows the email, so it
   * knows which person to compare against, and one comparison stays flat as staff
   * are added. The previous 1:N search scanned the whole global gallery on every
   * single login.
   */
  async verify(uuid: string, photo: PhotoInput): Promise<LuxandVerifyResult> {
    const form = new FormData();
    await this.appendPhoto(form, 'photo', photo, this.preprocessLogin);

    const data = await this.call('verify', `/photo/verify/${uuid}`, {
      method: 'POST',
      form,
      timeoutMs: TIMEOUTS.verify,
    });

    const raw = extractScore(data);
    if (raw === null) {
      // An unreadable body must fail loudly. Returning `matched: false` here would
      // lock out every user and read as "face recognition is broken" rather than
      // "Luxand changed its schema", and the raw body would never reach the log.
      throw new BadGatewayException(
        `Luxand verify: unrecognised response ${JSON.stringify(data).slice(0, 300)}`,
      );
    }

    const probability = normalizeScore(raw);
    return { matched: probability >= this.verifyMinConfidence, probability };
  }

  /**
   * Single-frame presentation-attack check. Kept as its own method so the caller
   * can run it concurrently with verify — same photo, independent endpoints.
   */
  async liveness(photo: PhotoInput): Promise<LuxandLiveness> {
    const form = new FormData();
    await this.appendPhoto(form, 'photo', photo, false);

    const data = await this.call('liveness', '/photo/liveness/v2', {
      method: 'POST',
      form,
      timeoutMs: TIMEOUTS.liveness,
    });

    const raw = extractScore(data);
    if (raw === null) {
      // Unlike verify, an unreadable liveness body should not block the login: it
      // is a secondary check, and failing open beats locking everyone out over a
      // field rename. The warning keeps it from passing unnoticed.
      this.logger.warn(
        `liveness: unrecognised response, treating as live: ${JSON.stringify(data).slice(0, 200)}`,
      );
      return { live: true, score: null };
    }

    const score = normalizeScore(raw);
    return { live: score >= this.livenessMin, score };
  }

  /**
   * 1:N fallback, reachable via LUXAND_LOGIN_MODE=search so verify can be switched
   * off in production with a restart rather than a deploy.
   */
  async search(photo: PhotoInput): Promise<LuxandMatch | null> {
    const form = new FormData();
    await this.appendPhoto(form, 'photo', photo, this.preprocessLogin);

    const data = await this.call('search', '/photo/search/v2', {
      method: 'POST',
      form,
      timeoutMs: TIMEOUTS.search,
    });

    // No face, or no match: this endpoint answers with a bare empty array.
    if (Array.isArray(data) && data.length === 0) return null;

    const uuid = extractId(data);
    const raw = extractScore(data);
    if (!uuid || raw === null) return null;

    const probability = normalizeScore(raw);
    return probability < this.searchMinConfidence
      ? null
      : { uuid, probability };
  }

  /**
   * Best-effort cleanup of a retired identity.
   *
   * Person uuids and legacy numeric subject ids live in separate namespaces and
   * take different paths, so both are tried. Note the legacy path is
   * `/subject/{id}`: the previous implementation used `/subject/v2/{id}`, which
   * Luxand parses as id="v2", so it deleted nothing and orphans accumulated
   * silently for every re-enrolment and every deleted user.
   */
  async deletePerson(id: string): Promise<void> {
    try {
      await this.call('deletePerson', `/v2/person/${id}`, {
        method: 'DELETE',
        timeoutMs: TIMEOUTS.deletePerson,
      });
      return;
    } catch {
      // Fall through and try the legacy subject namespace instead.
    }

    await this.call('deleteSubject', `/subject/${id}`, {
      method: 'DELETE',
      timeoutMs: TIMEOUTS.deletePerson,
    });
  }
}
