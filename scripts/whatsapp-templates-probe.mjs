#!/usr/bin/env node
/**
 * Probe the WhatsApp template facts this feature rests on and cannot assume.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Template creation was built on three claims about Meta that are cheap to check and
 * expensive to get wrong:
 *
 *   1. `GET /{waba}/message_templates` returns EVERY status, not just APPROVED. The
 *      APPROVED-only filter this codebase used to apply was OURS — and it is the reason a
 *      template submitted from the app would have been invisible for its entire review.
 *      If Meta really did return approved-only, the whole "see it pending" design is
 *      pointless and the poll has nothing to watch.
 *
 *   2. `rejected_reason` is actually populated on a REJECTED row. It is the only thing
 *      that tells somebody what to change, and the UI renders it.
 *
 *   3. The firm token holds `whatsapp_business_management`. Listing needs it, creating
 *      needs it, and a token without it fails in a way `listTemplates` deliberately
 *      swallows — so an unverified assumption here surfaces as a permanently empty picker.
 *
 * It also prints WHICH WEBHOOK FIELDS the Meta app is subscribed to, which decides
 * whether `message_template_status_update` can ever fire. As of writing, this account is
 * subscribed to `messages` ONLY — which is exactly why the client polls while anything is
 * pending rather than trusting the webhook.
 *
 * ⚠️ MUST RUN ON THE HETZNER HOST. The office network's TLS-intercepting proxy breaks
 * outbound TLS to Meta the same way it does to SignalWire.
 *
 *   ssh root@87.99.134.152
 *   cd cyg-server && node --env-file=.env scripts/whatsapp-templates-probe.mjs
 *
 * READ-ONLY. It submits nothing, deletes nothing, and costs nothing. Creating a real
 * template is deliberately NOT automated here: a name cannot be reused for four weeks
 * after deletion, so that is a decision to make by hand, once, with a dated throwaway
 * name.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* env may already be in the environment */
  }
}
loadEnv();

const strip = (v) => (v ?? '').trim().replace(/^["']|["']$/g, '');
const TOKEN = strip(process.env.WHATSAPP_TOKEN);
const WABA = strip(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
const APP_ID = strip(process.env.WHATSAPP_ID);
const APP_SECRET = strip(process.env.WHATSAPP_SECRET);
const VERSION = strip(process.env.WHATSAPP_GRAPH_VERSION) || 'v23.0';

if (!TOKEN || !WABA) {
  console.error(
    'Missing WHATSAPP_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID — nothing to probe.',
  );
  process.exit(1);
}

const BASE = `https://graph.facebook.com/${VERSION}`;
const findings = [];
const record = (q, a) => {
  findings.push(`${q}: ${a}`);
  console.log(`  => ${q}: ${a}`);
};

async function get(pathname, params = {}, token = TOKEN) {
  const url = new URL(`${BASE}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const started = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  console.log(`  GET ${pathname} -> ${res.status} (${Date.now() - started}ms)`);
  return { ok: res.ok, status: res.status, body };
}

// ── 1. Every template, unfiltered ────────────────────────────────────────────
async function templates() {
  console.log('\n── 1. Templates, unfiltered ──────────────────────────────────');
  const { ok, body } = await get(`/${WABA}/message_templates`, {
    fields: 'id,name,language,status,category,components,rejected_reason',
    limit: '200',
  });
  if (!ok) {
    record(
      'list templates',
      `FAILED — ${JSON.stringify(body?.error ?? body).slice(0, 200)}`,
    );
    return;
  }
  const list = body?.data ?? [];
  const byStatus = {};
  for (const t of list) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  record('token can list templates', 'yes — whatsapp_business_management is present');
  record('templates on this WABA', `${list.length} ${JSON.stringify(byStatus)}`);

  const statuses = Object.keys(byStatus);
  const nonApproved = statuses.filter((s) => s !== 'APPROVED');
  record(
    'returns non-APPROVED rows',
    list.length === 0
      ? 'UNPROVEN — no templates exist yet; submit one and re-run'
      : nonApproved.length > 0
        ? `YES (${nonApproved.join(', ')}) — our APPROVED-only filter was the thing hiding them`
        : 'only APPROVED rows exist right now, so this stays unproven',
  );

  const rejected = list.filter((t) => t.status === 'REJECTED');
  record(
    'rejected_reason populated',
    rejected.length === 0
      ? 'UNPROVEN — nothing rejected yet'
      : rejected.every((t) => t.rejected_reason)
        ? 'yes, on every rejected row'
        : 'NO — some rejected rows carry none, so the UI must tolerate a null reason',
  );

  for (const t of list.slice(0, 8)) {
    const body = (t.components ?? []).find(
      (c) => (c.type ?? '').toUpperCase() === 'BODY',
    );
    console.log(
      `     ${String(t.status).padEnd(10)} ${t.name} (${t.language}) cat=${t.category}` +
        ` body=${body ? 'yes' : 'NONE'} reject=${t.rejected_reason ?? '-'}`,
    );
  }
}

// ── 2. Which webhook fields are actually live ────────────────────────────────
async function webhookFields() {
  console.log('\n── 2. Webhook fields ─────────────────────────────────────────');
  const sub = await get(`/${WABA}/subscribed_apps`);
  record(
    'app subscribed to this WABA',
    sub.ok && (sub.body?.data ?? []).length > 0 ? 'yes' : 'NO — messages will not arrive',
  );

  if (!APP_ID || !APP_SECRET) {
    record('webhook fields', 'UNKNOWN — set WHATSAPP_ID and WHATSAPP_SECRET to read them');
    return;
  }
  const { ok, body } = await get(
    `/${APP_ID}/subscriptions`,
    {},
    `${APP_ID}|${APP_SECRET}`,
  );
  if (!ok) {
    record('webhook fields', `could not read — ${JSON.stringify(body?.error).slice(0, 160)}`);
    return;
  }
  const waba = (body?.data ?? []).find(
    (s) => s.object === 'whatsapp_business_account',
  );
  const fields = (waba?.fields ?? []).map((f) => f.name ?? f);
  console.log(`     subscribed fields: ${fields.join(', ') || '(none)'}`);
  record(
    'message_template_status_update',
    fields.includes('message_template_status_update')
      ? 'SUBSCRIBED — approval will arrive by webhook as well as by the poll'
      : 'NOT subscribed — approval is noticed ONLY by the client poll. Tick it in ' +
          'Meta App → WhatsApp → Configuration → Webhook fields to make it instant.',
  );
}

(async () => {
  console.log('WhatsApp templates probe');
  console.log(`  waba=${WABA} graph=${VERSION}`);
  await templates();
  await webhookFields();

  console.log('\n── Verdict ───────────────────────────────────────────────────');
  for (const f of findings) console.log(`  ${f}`);
  console.log(
    '\nTo prove the rest (does Meta accept our component shape, does it auto-approve a\n' +
      'simple UTILITY template, what a rejection reads like) submit ONE dated throwaway\n' +
      'template from the app — e.g. cyg_probe_2026_09_17 — and re-run this. A deleted\n' +
      'name cannot be reused for four weeks, so pick a name you will not want.',
  );
})().catch((err) => {
  console.error('\nProbe failed:', err);
  if (String(err).includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
    console.error('\n⚠️ That is the office TLS proxy. Run this on the Hetzner host.');
  }
  process.exit(1);
});
