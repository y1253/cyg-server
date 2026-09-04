#!/usr/bin/env node
/**
 * POST a correctly-signed `voice/status` webhook at a running server and show whether a
 * CallSummary row was queued for it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
 * Companion to `laml-probe.mjs`, and for the same reason: SignalWire is unreachable from
 * the office network, so nothing that talks to the provider can be exercised here. But
 * the SUMMARY TRIGGER does not talk to the provider at all — the status webhook only
 * writes a PENDING row and returns. That half is therefore fully testable locally, which
 * matters because it is the half that decides whether a call ever gets summarised.
 *
 * It makes NO provider calls and spends no money. The row it queues will be picked up by
 * the sweep, which DOES call SignalWire and OpenAI — so run this against a local server
 * (where the sweep will fail harmlessly and retry) rather than against production, unless
 * you actually want that call summarised.
 *
 * ── WHAT IT PROVES, AND WHAT IT DOES NOT ────────────────────────────────────────
 * Proves: the signature is right, the terminal-status branch fires, and the row lands
 * with the company resolved (or null, for an internal staff call).
 * Does NOT prove: transcription, summarisation, or that OpenAI accepts our audio. Those
 * need the Hetzner host.
 *
 * Usage (server running, PHONE_SUMMARIZE_CALLS=1):
 *   node scripts/summary-probe.mjs --to=+14382561210
 *   node scripts/summary-probe.mjs --to=+14382561210 --status=no-answer
 *   node scripts/summary-probe.mjs --to=+14382561210 --sid=my-call-1
 *
 * `--status=in-progress` is the useful negative: a non-terminal status must queue
 * NOTHING, which is what keeps a ringing call from being summarised mid-conversation.
 */
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  }),
);

const to = args.to;
if (!to) {
  console.error(
    'Usage: node scripts/summary-probe.mjs --to=+14382561210 [--from=…] [--status=…] [--sid=…] [--url=…]',
  );
  process.exit(1);
}

const from = args.from ?? '+15145550001';
const status = args.status ?? 'completed';
const callSid = args.sid ?? 'probe-' + Math.random().toString(16).slice(2, 10);

/**
 * Mirrors `webhookBase()` in phone.config.ts, including the fallback order.
 *
 * A BLANK variable must fall through, which `??` does not do — see the same note in
 * laml-probe.mjs, where getting this wrong read as "your signing key is wrong".
 */
const base = (
  [process.env.PHONE_WEBHOOK_BASE_URL, process.env.CALLBACK_BASE_URL].find(
    (value) => (value ?? '').trim() !== '',
  ) ?? 'http://localhost:3000'
)
  .trim()
  .replace(/\/+$/, '');

/** What SignalWire was configured with, and therefore what the server signs against. */
const signedUrl = `${base}/api/phone/voice/status`;
const postUrl = `${(args.url ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/phone/voice/status`;

const key = process.env.SIGNALWIRE_SIGN_KEY;
if (!key) {
  console.error(
    'SIGNALWIRE_SIGN_KEY is not set in server/.env — the webhook rejects every request ' +
      'without it, by design. Do not work around it by unsetting the key: failing closed ' +
      'is the security boundary.',
  );
  process.exit(1);
}

const params = {
  From: from,
  To: to,
  CallSid: callSid,
  CallStatus: status,
  CallDuration: args.duration ?? '42',
};

/** signatureBase(): url + each key + value, keys sorted, concatenated bare. */
const signature = createHmac('sha1', key)
  .update(
    Buffer.from(
      Object.keys(params)
        .sort()
        .reduce((acc, k) => acc + k + String(params[k] ?? ''), signedUrl),
      'utf-8',
    ),
  )
  .digest('base64');

if (process.env.PHONE_SUMMARIZE_CALLS !== '1') {
  console.log(
    '⚠  PHONE_SUMMARIZE_CALLS is not "1" in this shell. That flag is read by the ' +
      'SERVER, not by this script — if the server was started without it, no row will ' +
      'be queued and that is correct behaviour, not a failure.\n',
  );
}

console.log(`POST   ${postUrl}`);
console.log(`signed ${signedUrl}`);
console.log(`CallSid=${callSid} CallStatus=${status} To=${to} From=${from}`);
console.log('');

const res = await fetch(postUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-signalwire-signature': signature,
  },
  body: new URLSearchParams(params),
});

console.log(`HTTP ${res.status} ${res.headers.get('content-type') ?? ''}`);
console.log('');

if (!res.ok) {
  console.error('The webhook rejected the request — the signature or the URL is wrong.');
  process.exit(1);
}

// The enqueue is fire-and-forget, so the response can beat the write by a few ms.
await new Promise((r) => setTimeout(r, 400));

const prisma = new PrismaClient();
try {
  const row = await prisma.callSummary.findUnique({ where: { callSid } });
  const terminal = !['queued', 'ringing', 'in-progress'].includes(status);

  if (row) {
    console.log('Queued:');
    console.log(`  status       ${row.status}`);
    console.log(`  companyId    ${row.companyId ?? 'null (internal / unrouted)'}`);
    console.log(`  recordingSid ${row.recordingSid ?? '— (the sweep will find it)'}`);
    console.log(`  attempts     ${row.attempts}`);
    console.log('');
    console.log(
      terminal
        ? 'Correct: a finished call is queued for summarisation.'
        : '✗ WRONG: a non-terminal status must NOT queue anything.',
    );
  } else {
    console.log('No CallSummary row for this sid.');
    console.log('');
    console.log(
      terminal
        ? 'Expected a row. Either the server was started without PHONE_SUMMARIZE_CALLS=1, ' +
            'or the trigger is broken.'
        : 'Correct: a call that has not finished is not queued.',
    );
  }
} finally {
  await prisma.$disconnect();
}
