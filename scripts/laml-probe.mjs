#!/usr/bin/env node
/**
 * POST a correctly-signed inbound-call webhook at a running server and print the LaML.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
 * SignalWire is unreachable from the office network (the Geder Filter re-signs TLS and
 * Node rejects it), so `signalwire-probe.mjs` and friends can only run on Hetzner. This
 * one needs SignalWire for NOTHING: the inbound webhook is an ordinary signed HTTP POST
 * to our own server, so the whole hours/greeting decision can be exercised locally.
 *
 * It makes NO provider calls and spends no money.
 *
 * ── THE SIGNATURE IS NOT OPTIONAL ───────────────────────────────────────────────
 * The webhook fails CLOSED with no signing key, deliberately. So this computes a real
 * one, exactly as `signature.util.ts` does: HMAC-SHA1 over the configured URL plus the
 * params sorted by key and concatenated bare, base64. Do not "simplify" testing by
 * unsetting SIGNALWIRE_SIGN_KEY — the fail-closed behaviour is the security boundary.
 *
 * The URL signed is the one from `webhookUrls()`, NOT the URL this script posts to. That
 * is the same rule the server follows: behind nginx the request URL differs from the
 * configured one, and the signature is computed over the configured one on both sides.
 *
 * Usage (server running via `npm run start:dev`):
 *   node scripts/laml-probe.mjs --to=+14382561210
 *   node scripts/laml-probe.mjs --to=+14382561210 --at=2026-09-01T23:00:00Z
 *   node scripts/laml-probe.mjs --to=+14382561210 --from=+15145550001 --url=http://localhost:3000
 *
 * `--at` only labels the run: the SERVER reads its own clock. To exercise after-hours at
 * ten in the morning, set that company's hours to a window that excludes now (or use the
 * admin UI's preview endpoint, which does accept an instant).
 */
import 'dotenv/config';
import { createHmac } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  }),
);

/**
 * Which webhook to exercise.
 *
 * `inbound` (default) is the call itself. The other two are the SCREENING pair a staff
 * member's own phone runs when `ringMobiles` is on: the whisper it hears on answering, and
 * the keypress that bridges it. All three are ordinary signed POSTs to our own server, so
 * all three cost nothing and work from the office network.
 */
const ROUTES = {
  inbound: 'voice/inbound',
  screen: 'voice/screen',
  accept: 'voice/screen-accept',
};
const route = args.route ?? 'inbound';
if (!ROUTES[route]) {
  console.error(`--route must be one of: ${Object.keys(ROUTES).join(', ')}`);
  process.exit(1);
}

const to = args.to;
if (!to) {
  console.error(
    [
      'Usage: node scripts/laml-probe.mjs --to=+14382561210 [--from=…] [--url=…]',
      '       node scripts/laml-probe.mjs --route=screen --to=+15145550123 [--parent=<root sid>]',
      '       node scripts/laml-probe.mjs --route=accept --to=+15145550123 --digits=1',
    ].join('\n'),
  );
  process.exit(1);
}

const from = args.from ?? '+15145550001';
const callSid = args.sid ?? 'probe-' + Math.random().toString(16).slice(2, 10);

/**
 * Mirrors `webhookBase()` in phone.config.ts, including the fallback order.
 *
 * A BLANK variable must fall through, which `??` does not do -- `PHONE_WEBHOOK_BASE_URL=`
 * with nothing after it is an empty STRING, not undefined, so `??` returns it and every
 * signature is computed over a relative URL that matches nothing the server signs. The
 * server was hardened against exactly this; the probe had the original bug, which made it
 * 403 against a correctly-configured server and read as "your signing key is wrong".
 */
const base = (
  [process.env.PHONE_WEBHOOK_BASE_URL, process.env.CALLBACK_BASE_URL].find(
    (value) => (value ?? '').trim() !== '',
  ) ?? 'http://localhost:3000'
)
  .trim()
  .replace(/\/+$/, '');

/** What SignalWire was configured with, and therefore what the server signs against. */
const signedUrl = `${base}/api/phone/${ROUTES[route]}`;
/** Where this script actually sends the request — usually localhost.  */
const postUrl = `${(args.url ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/phone/${ROUTES[route]}`;

const key = process.env.SIGNALWIRE_SIGN_KEY;
if (!key) {
  console.error(
    'SIGNALWIRE_SIGN_KEY is not set in server/.env — the webhook rejects every request ' +
      'without it, by design. Copy the Signing Key from the SignalWire dashboard ' +
      '(API Credentials). It is NOT the API token.',
  );
  process.exit(1);
}

/**
 * On a screening webhook `To` is the STAFF MOBILE and `From` is the pass-through customer
 * CLI — SignalWire posts the child leg's own view. `ParentCallSid` is how the server finds
 * which call it is about with no query string; omit it with `--parent=` to exercise the
 * by-mobile fallback, and pass a sid nobody registered to see the degraded whisper.
 */
const params =
  route === 'inbound'
    ? { From: from, To: to, CallSid: callSid }
    : {
        From: from,
        To: to,
        CallSid: 'child-' + callSid,
        ...(args.parent === '' ? {} : { ParentCallSid: args.parent ?? callSid }),
        ...(route === 'accept' ? { Digits: args.digits ?? '1' } : {}),
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

const body = new URLSearchParams(params);

console.log(`POST   ${postUrl}`);
console.log(`signed ${signedUrl}`);
console.log(`From=${from} To=${to} CallSid=${callSid}`);
if (args.at) console.log(`(note: --at=${args.at} is a label only — the server reads its own clock)`);
console.log('');

const res = await fetch(postUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-signalwire-signature': signature,
  },
  body,
});

const xml = await res.text();
console.log(`HTTP ${res.status} ${res.headers.get('content-type') ?? ''}`);
console.log('');
// One verb per line: the interesting question is always which verbs came back, in what
// order, so a single 300-character line is the wrong shape to read.
console.log(xml.replace(/></g, '>\n<'));
console.log('');

if (res.status === 403) {
  console.log(
    'Rejected. Either SIGNALWIRE_SIGN_KEY here differs from the running server, or ' +
      'PHONE_WEBHOOK_BASE_URL does — both sides must sign the SAME url.',
  );
} else if (route === 'screen') {
  if (!xml.includes('<Gather')) {
    console.log('=> NO WHISPER. The mobile would be bridged straight through, so a');
    console.log('   carrier voicemail could answer and swallow the call.');
  } else {
    const named = /<Say[^>]*>Call for ([^<.]+)/.exec(xml);
    console.log(
      named
        ? `=> The mobile hears "Call for ${named[1].trim()}…" and presses 1 to accept.`
        : '=> DEGRADED whisper (no expectation matched) — anonymous, but 1 still accepts.',
    );
  }
} else if (route === 'accept') {
  if (xml.includes('<Hangup/>')) {
    console.log('=> Declined: this leg ends, the <Dial> keeps ringing the browsers,');
    console.log('   and the caller still reaches the COMPANY voicemail.');
  } else {
    console.log('=> Accepted: empty document, so the whisper ends and the legs bridge.');
  }
} else if (xml.includes('<Hangup/>') && !xml.includes('<Dial')) {
  console.log('=> Caller hears a message and the call ends. No browser is rung.');
} else if (xml.includes('<Say') && xml.includes('<Dial')) {
  console.log('=> Caller hears a message, then the browser rings.');
} else if (xml.includes('<Dial')) {
  console.log('=> The browser rings immediately, with no greeting.');
}

if (route === 'inbound') {
  const mobiles = [...xml.matchAll(/<Number[^>]*>([^<]+)<\/Number>/g)].map((m) => m[1]);
  console.log(
    mobiles.length
      ? `   Mobiles also ringing: ${mobiles.join(', ')} (screened — they must press 1).`
      : '   No mobile is rung: ringMobiles off, nobody assigned, or no number on file.',
  );
}
