/**
 * Placeholder substitution for the three caller-facing messages.
 *
 * ── ESCAPING IS NOT THIS MODULE'S JOB ───────────────────────────────────────────
 * This produces PLAIN TEXT. `laml.util.ts` owns all XML escaping and does it exactly
 * once, at the `<Say>` boundary, via `esc()`. Escaping here as well turns
 * "O'Brien Bookkeeping" into `O&amp;apos;Brien Bookkeeping`, which SignalWire happily
 * reads out to the caller entity by entity. `laml.util.spec.ts` already pins the
 * single-escape case; `phone-message.util.spec.ts` pins that this side adds none.
 */

/**
 * The tokens an admin may use, served to the client so its insertable chips cannot drift
 * from what actually substitutes.
 */
export const PLACEHOLDERS = [
  {
    token: '{company name}',
    label: 'Company name',
    key: 'company',
    example: 'Acme Bookkeeping',
  },
  {
    token: '{phone}',
    label: 'Support number',
    key: 'phone',
    example: '+1 438 256 1210',
  },
  {
    token: '{hours}',
    label: "Today's hours",
    key: 'hours',
    example: '9 AM to 5 PM',
  },
] as const;

export interface MessageVars {
  company: string;
  phone: string;
  hours: string;
}

/**
 * Matches `{anything}` where the contents are letters and spaces.
 *
 * A regex rather than `replaceAll('{company name}', …)` because the admin-facing token is
 * literally `{company name}` — **with a space** — and people will also type `{company}`,
 * `{companyName}` and `{ Company Name }`. Normalising inside one pattern accepts all four
 * without four passes.
 */
const TOKEN_RE = /\{\s*([a-z][a-z ]*?)\s*\}/gi;

/** `"Company Name"` / `"companyName"` / `"company name"` → `"companyname"`. */
function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
}

/** Accepted spellings, normalised, mapped to the var they fill. */
const KEY_ALIASES: Record<string, keyof MessageVars> = {
  company: 'company',
  companyname: 'company',
  business: 'company',
  businessname: 'company',
  phone: 'phone',
  number: 'phone',
  supportnumber: 'phone',
  hours: 'hours',
  todayshours: 'hours',
};

/**
 * Substitute the placeholders in `template`.
 *
 * Three rules, each with a test:
 *
 *  - **ONE `.replace()` pass**, never sequential replacements. Sequential means a value
 *    that itself contains `{phone}` — a company actually named that, or an admin pasting
 *    a template into a field — gets expanded again on the next pass.
 *  - **An unknown placeholder is left VERBATIM.** An admin who types `{comapny}` must
 *    hear their own typo read out, not silence. A blanked token is an invisible bug on a
 *    live client-facing line.
 *  - **A missing var renders `''`**, never the string "undefined".
 */
export function renderMessage(template: string, vars: MessageVars): string {
  if (typeof template !== 'string') return '';
  return template.replace(TOKEN_RE, (match, rawKey: string) => {
    const key = KEY_ALIASES[normalizeKey(rawKey)];
    if (!key) return match;
    return vars[key] ?? '';
  });
}
