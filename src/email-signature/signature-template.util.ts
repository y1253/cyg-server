/**
 * Placeholder substitution for the email signature.
 *
 * ── ESCAPING IS THIS MODULE'S JOB, UNLIKE ITS PHONE TWIN ────────────────────────
 * `phone-message.util.ts` deliberately escapes NOTHING: it emits plain text for `<Say>`,
 * and `laml.util.ts` owns the XML escaping and does it exactly once at that boundary.
 * Escaping on both sides turns "O'Brien Bookkeeping" into `O&amp;apos;Brien`.
 *
 * Here the rule INVERTS, and copying the phone version without noticing is the trap this
 * header exists to prevent. This emits **HTML**, and there is no later boundary — the
 * output is spliced straight into a mail body. So each substituted VALUE is escaped
 * exactly once, while the admin's own template markup is left alone (it is deliberately
 * rich HTML). Without that, a company called "Smith & Sons" emits invalid markup and a
 * company name becomes the injection point.
 *
 * The template itself is not trusted blindly either — see `sanitizeSignatureHtml`.
 */

/**
 * The tokens an admin may use, served to the client so its insertable chips cannot drift
 * from what actually substitutes.
 *
 * The first three are exactly what the two hardcoded builders already read off a company;
 * the accountant fields are the obvious neighbours, and `{logo}` is how an uploaded image
 * gets placed.
 */
export const PLACEHOLDERS = [
  {
    token: '{company name}',
    label: 'Company name',
    key: 'company',
    example: 'Acme Bookkeeping',
  },
  {
    token: '{support number}',
    label: 'Support number',
    key: 'phone',
    example: '+1 438 256 1210',
  },
  {
    token: '{billing email}',
    label: 'Billing email',
    key: 'email',
    example: 'billing@acme.com',
  },
  {
    token: '{accountant}',
    label: 'Accountant',
    key: 'accountant',
    example: 'Dana Levy',
  },
  {
    token: '{accountant email}',
    label: 'Accountant email',
    key: 'accountantemail',
    example: 'dana@cygfinance.com',
  },
  {
    token: '{accountant phone}',
    label: 'Accountant phone',
    key: 'accountantphone',
    example: '+1 514 555 0100',
  },
  {
    token: '{logo}',
    label: 'Logo',
    key: 'logo',
    example: '[logo]',
  },
] as const;

export interface SignatureVars {
  company: string;
  phone: string;
  email: string;
  accountant: string;
  accountantemail: string;
  accountantphone: string;
  /**
   * The logo's absolute public URL, or `null` for "no logo".
   *
   * A URL rather than pre-built markup, so the `<img>` this module emits is the only one
   * and its attributes cannot be supplied by a caller.
   */
  logoUrl: string | null;
}

/** Matches `{anything}` where the contents are letters and spaces. Mirrors the phone side. */
const TOKEN_RE = /\{\s*([a-z][a-z ]*?)\s*\}/gi;

/** `"Company Name"` / `"companyName"` / `"company name"` → `"companyname"`. */
function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
}

/** Accepted spellings, normalised, mapped to the var they fill. */
const KEY_ALIASES: Record<string, keyof SignatureVars | 'logo'> = {
  company: 'company',
  companyname: 'company',
  business: 'company',
  businessname: 'company',
  phone: 'phone',
  number: 'phone',
  supportnumber: 'phone',
  email: 'email',
  billingemail: 'email',
  accountant: 'accountant',
  accountantname: 'accountant',
  accountantemail: 'accountantemail',
  accountantphone: 'accountantphone',
  logo: 'logo',
  image: 'logo',
};

/**
 * HTML-escape one substituted value, exactly once.
 *
 * Quotes included, because a value can land inside an attribute in an admin-authored
 * template (`<a href="mailto:{billing email}">`), where escaping only `&<>` would let a
 * stray `"` break out.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cap so a large upload cannot blow out a recipient's layout. Matches the client's box. */
const LOGO_MAX_WIDTH_PX = 180;

/** The one `<img>` this module ever emits. */
function logoTag(url: string): string {
  return (
    `<img src="${escapeHtml(url)}" alt="" ` +
    `style="max-width:${LOGO_MAX_WIDTH_PX}px;height:auto;border:0" />`
  );
}

/**
 * Substitute the placeholders in `template`.
 *
 * Four rules, each with a test:
 *
 *  - **ONE `.replace()` pass**, never sequential replacements. Sequential means a value
 *    that itself contains `{logo}` — a company actually named that, or an admin pasting a
 *    template into a field — gets expanded again on the next pass.
 *  - **An unknown placeholder is left VERBATIM.** An admin who types `{comapny}` must see
 *    their own typo in the preview, not silence. A blanked token is an invisible bug on
 *    every outgoing email.
 *  - **A missing var renders `''`**, never the string "undefined".
 *  - **Every substituted value is escaped exactly once** (see the module header). `{logo}`
 *    is the sole exception and is not user input: it renders markup this module builds.
 */
export function renderSignature(
  template: string,
  vars: SignatureVars,
): string {
  if (typeof template !== 'string') return '';
  return template.replace(TOKEN_RE, (match, rawKey: string) => {
    const key = KEY_ALIASES[normalizeKey(rawKey)];
    if (!key) return match;
    if (key === 'logo') return vars.logoUrl ? logoTag(vars.logoUrl) : '';
    return escapeHtml(vars[key] ?? '');
  });
}

/**
 * A forbidden element WITH its contents.
 *
 * Runs before `FORBIDDEN_TAGS` below, and requires the closing tag rather than offering
 * `>` as an alternative. A lazy `(?:<\/script>|>)` matches the `>` that ends the OPENING
 * tag first, so `<script>evil()</script>` loses only its tags and leaves `evil()` behind as
 * visible text in the signature. Pinned by a test.
 */
const FORBIDDEN_ELEMENTS =
  /<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
/** Any remaining forbidden tag — void elements, and unbalanced strays. */
const FORBIDDEN_TAGS =
  /<\s*\/?\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi;
/** `onclick=…`, quoted or bare. */
const EVENT_ATTRS = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
/** `href="javascript:…"` and friends. */
const JS_URLS = /\s(?:href|src|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi;

/**
 * Strip the handful of things that must never reach a stored, re-served signature.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────────
 * It is **defence in depth behind an ADMIN-only route**, not a general-purpose HTML
 * sanitizer. It is regex-based because the server has no DOM and this codebase has no
 * sanitizer dependency; a determined author can defeat it, and that is accepted, because
 * the only people who can reach the write route are the firm's own super-admins.
 *
 * It exists because the template is **stored and re-served into another member of staff's
 * `contentEditable` composer**, which makes a careless paste a genuine admin→staff stored
 * XSS path rather than merely the author's own problem. The client runs the existing
 * `sanitizeForwardHtml` (DOM-based, `message-utils.ts`) before PATCHing as the first
 * layer; this is the one that survives a direct API call.
 *
 * If this ever needs to be airtight, the answer is a real sanitizer dependency, not a
 * longer regex.
 */
export function sanitizeSignatureHtml(html: string): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(FORBIDDEN_ELEMENTS, '')
    .replace(FORBIDDEN_TAGS, '')
    .replace(EVENT_ATTRS, '')
    .replace(JS_URLS, '');
}
