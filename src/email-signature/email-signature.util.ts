/**
 * Global default + per-company override resolution for the email signature.
 *
 * A faithful sibling of `phone-settings.util.ts` — same singleton, same field list, same
 * resolver shape — because the two features answer the same question and a second, subtly
 * different implementation of "which value wins" is how they drift.
 *
 * ── THE OVERRIDE RULE, ONCE ─────────────────────────────────────────────────────
 * On `CompanyEmailSignature` every column is nullable and **NULL is the only absence**.
 * `''` and `0` are VALUES an admin deliberately chose: `signatureHtml: ''` means "this
 * company sends no signature" and `signatureImageId: 0` means "no logo". So resolution is
 * `company[k] ?? global[k]` and **never** `company[k] || global[k]` — under `||` both of
 * those silently revert to the global, which is a company quietly re-acquiring a signature
 * somebody removed on purpose.
 */

export interface EffectiveEmailSignature {
  /** Rich HTML with tokens still unsubstituted. `''` = send no signature. */
  signatureHtml: string;
  /** `SignatureImage.id`, or 0 for no logo. */
  signatureImageId: number;
}

export type SignatureSource = Record<
  keyof EffectiveEmailSignature,
  'company' | 'default'
>;

export type EmailSignatureOverrides = {
  [K in keyof EffectiveEmailSignature]: EffectiveEmailSignature[K] | null;
};

export const SETTINGS_SINGLETON = 'GLOBAL';

/**
 * THE field list. Both `resolveSignature` and the DTO→Prisma mapper in the service walk
 * this, so a field cannot be added to one and forgotten in the other — which is exactly
 * how an override silently stops being saved.
 */
export const SIGNATURE_FIELDS = [
  'signatureHtml',
  'signatureImageId',
] as const satisfies readonly (keyof EffectiveEmailSignature)[];

/**
 * The signature this feature ships with: the exact markup the two hardcoded builders
 * produced, with the three live company fields turned into tokens.
 *
 * Keeping it byte-equivalent is the point — the feature goes live changing nothing anybody
 * can see, and the first visible change is one an admin makes deliberately.
 *
 * `{support number}` and `{billing email}` sat on conditional lines before: the old builder
 * omitted the whole `<div>` when the value was missing. A token renders `''` instead, so an
 * empty line appears. That is the one intentional difference, and it is preferable to
 * conditional markup an admin cannot see or edit.
 */
export const SEED_DEFAULTS: EffectiveEmailSignature = {
  signatureHtml: [
    '<div>{company name}</div>',
    '<div>Accounting Department</div>',
    '<div>{support number}</div>',
    '<div>{billing email}</div>',
    '<div><br></div>',
    '<div style="font-size:0.85em">accounting managed by ' +
      '<a href="https://cygfinance.com">CYG FINANCE</a></div>',
  ].join(''),
  signatureImageId: 0,
};

/**
 * What a settings-read failure falls back to.
 *
 * Identical to `SEED_DEFAULTS`, and deliberately NOT an empty signature: `effectiveFor`
 * feeds `getAccount`, so a database blip must degrade to the signature everybody already
 * had rather than silently start sending unsigned mail — which nobody would notice.
 */
export const HARDCODED_FALLBACK: EffectiveEmailSignature = SEED_DEFAULTS;

/** Prisma's row types, loosened just enough to cross into the resolver without casts. */
export type RawSignatureDefaults = EffectiveEmailSignature;
export type RawSignatureOverrides = {
  [K in keyof EffectiveEmailSignature]?: EffectiveEmailSignature[K] | null;
};

/**
 * Resolve the global row and this company's overrides into one answer, plus a per-field
 * record of where each value came from.
 *
 * `source[key]` is derived from `override === null`, never from comparing values: a
 * company that deliberately set its signature to the same text as the global default has
 * an override, and telling it apart matters — a later edit to the global must not reach it.
 */
export function resolveSignature(
  global: RawSignatureDefaults | null,
  company: RawSignatureOverrides | null,
): { effective: EffectiveEmailSignature; source: SignatureSource } {
  const base: EffectiveEmailSignature = global
    ? { ...global }
    : { ...HARDCODED_FALLBACK };

  const effective = {} as EffectiveEmailSignature;
  const source = {} as SignatureSource;

  for (const key of SIGNATURE_FIELDS) {
    const override = company?.[key] ?? null;
    // `??`, not `||`. See the module header.
    (effective[key] as unknown) = override ?? base[key];
    source[key] = override === null ? 'default' : 'company';
  }

  return { effective, source };
}

/**
 * Resolve a settings value to a usable image id.
 *
 * `0` is the "none" sentinel on both tables — NULL means "inherit" on the per-company row,
 * so it cannot also mean "none". Everything that reads an image id goes through here, so
 * the sentinel is interpreted in exactly one place. Mirrors `audioIdOrNone`.
 */
export function imageIdOrNone(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}
