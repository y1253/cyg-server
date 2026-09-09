/**
 * The base URL for links that must resolve from OUTSIDE this application.
 *
 * Today that is exactly one thing: the signature logo, whose `<img src>` is fetched by a
 * stranger's mail client — or by Gmail's image proxy on their behalf — with no session,
 * no cookie and no knowledge of this app at all. Every other byte route in the codebase
 * builds a relative URL because the only fetcher is a logged-in browser.
 *
 * ── WHY NOT `webhookBase()` ─────────────────────────────────────────────────────
 * That function's own docblock is explicit that `PHONE_WEBHOOK_BASE_URL` exists to be
 * repointed at an ngrok tunnel while developing phone webhooks, precisely so doing so
 * cannot disturb anything else. Borrowing it here would put a mail-facing image URL behind
 * a variable somebody is expected to point at a temporary tunnel.
 *
 * ⚠️ The blank-env-var hardening is copied deliberately, not by habit. `??` alone returns
 * the empty string for a declared-but-blank `PUBLIC_BASE_URL=`, which yields a RELATIVE
 * `src` — and a relative src in an email resolves against the recipient's webmail host, so
 * the logo silently 404s for everyone while looking perfectly fine in the composer. The
 * same bug bit `phone.config.ts` and the LaML probe. Blanks fall through; only a real
 * value wins.
 */
export function publicBase(env: Record<string, string | undefined>): string {
  const first = [env.PUBLIC_BASE_URL, env.CALLBACK_BASE_URL].find(
    (value) => (value ?? '').trim() !== '',
  );
  return (first ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
}

/** Absolute, mail-safe URL for one signature logo. */
export function signatureImageUrl(
  env: Record<string, string | undefined>,
  publicId: string,
): string {
  return `${publicBase(env)}/api/signature-images/public/${encodeURIComponent(publicId)}`;
}
