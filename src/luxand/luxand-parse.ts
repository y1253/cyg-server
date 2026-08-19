/**
 * Pure parsing helpers for Luxand responses.
 *
 * These live apart from LuxandService because they carry the riskiest assumptions
 * in the whole face-login path: Luxand does not publish the response schema for
 * /photo/verify, and the shape genuinely differs between endpoints. Keeping them
 * pure means the guesswork is unit-tested rather than only discovered in
 * production.
 */

export type LuxandJson = Record<string, unknown> | unknown[] | null;

/** Field names Luxand might plausibly use for a match score. */
const SCORE_KEYS = [
  'probability',
  'confidence',
  'similarity',
  'score',
] as const;

const ID_KEYS = ['uuid', 'id', 'person_uuid', 'personUuid'] as const;

/**
 * Luxand's own error wording is specific and actionable ("avoid backlight and
 * strong shadows"), so it is worth showing the user verbatim. Anything else stays
 * in the log and is reported generically.
 */
const SAFE_TO_SURFACE = [
  'no face detected',
  'find faces',
  'issues with the image',
] as const;

function scanForScore(obj: unknown): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const key of SCORE_KEYS) {
    const value = rec[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (
      typeof value === 'string' &&
      value.trim() &&
      !Number.isNaN(Number(value))
    ) {
      return Number(value);
    }
  }
  return null;
}

function scanForId(obj: unknown, keys: readonly string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Find a match score anywhere it plausibly lives: top level, nested under
 * `result`/`data`, or on the first element of an array.
 */
export function extractScore(data: LuxandJson): number | null {
  if (Array.isArray(data)) return data.length ? scanForScore(data[0]) : null;

  const direct = scanForScore(data);
  if (direct !== null) return direct;

  const rec = data ?? {};
  return scanForScore(rec.result) ?? scanForScore(rec.data);
}

/**
 * Scores may arrive 0-1 or 0-100 depending on the endpoint. Normalise to 0-1 so a
 * configured threshold means one thing everywhere, instead of silently meaning
 * "always pass" or "never pass" on whichever endpoint uses the other scale.
 */
export function normalizeScore(score: number): number {
  return score > 1 ? score / 100 : score;
}

/** Find the person/subject identifier in a create or search response. */
export function extractId(data: LuxandJson): string | null {
  const root = Array.isArray(data) ? (data[0] ?? null) : data;

  const direct = scanForId(root, ID_KEYS);
  if (direct) return direct;

  const rec = (root ?? {}) as Record<string, unknown>;
  return (
    scanForId(rec.person, ['uuid', 'id']) ??
    scanForId(rec.result, ['uuid', 'id']) ??
    scanForId(rec.data, ['uuid', 'id'])
  );
}

/**
 * Luxand reports most failures as HTTP 200 with `{"status":"failure"}`, so the
 * status code alone is not an error check. It also returns a bare 500 for some
 * malformed requests, so the body alone is not one either — callers must test
 * both.
 */
export function isFailureEnvelope(data: LuxandJson): boolean {
  return data !== null && !Array.isArray(data) && data.status === 'failure';
}

/** The message field of a failure body, falling back to the raw text. */
export function failureMessage(data: LuxandJson, raw: string): string {
  if (data && !Array.isArray(data)) {
    const message = data.message;
    if (typeof message === 'string' && message) return message;
  }
  return raw;
}

/** Show the user what they can act on; keep everything else internal. */
export function describeLuxandError(message: string): string {
  const lower = message.toLowerCase();
  return SAFE_TO_SURFACE.some((s) => lower.includes(s))
    ? message.trim()
    : 'Face service error';
}
