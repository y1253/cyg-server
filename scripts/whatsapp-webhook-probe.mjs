#!/usr/bin/env node
/**
 * POST a correctly-signed WhatsApp webhook at a running server — zero Meta traffic.
 *
 * The laml-probe.mjs idea for WhatsApp: proves signature verification, parsing, storage,
 * the inbox row, the dashboard badge and the bell, all from a laptop.
 *
 *   node --env-file=.env scripts/whatsapp-webhook-probe.mjs                       # a text
 *   node --env-file=.env scripts/whatsapp-webhook-probe.mjs --text="Invoice attached?"
 *   node --env-file=.env scripts/whatsapp-webhook-probe.mjs --type=voice          # voice note
 *   node --env-file=.env scripts/whatsapp-webhook-probe.mjs --status=read --wamid=wamid.X
 *   node --env-file=.env scripts/whatsapp-webhook-probe.mjs --bad-signature       # expect 403
 *
 * Options: --base=http://localhost:3000  --phone-number-id=<id>  --from=15145550000
 *          --name="Probe Customer"  --wamid=<id>  (re-send the same wamid: no duplicate)
 *
 * A --type=voice probe names a media id Meta has never heard of, so its download FAILS:
 * the row shows "Voice message unavailable" after 3 attempts. That is the expected result
 * here — playback needs a real voice note from a phone.
 */
import { createHmac, randomUUID } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);

const base = String(args.base ?? 'http://localhost:3000').replace(/\/$/, '');
const secret = process.env.WHATSAPP_SECRET?.trim();
const phoneNumberId = String(
  args['phone-number-id'] ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
).trim();
const from = String(args.from ?? '15145550000');
const wamid = String(args.wamid ?? `wamid.PROBE${randomUUID().replace(/-/g, '')}`);
const now = Math.floor(Date.now() / 1000).toString();

if (!secret) {
  console.error('WHATSAPP_SECRET is not set — run with --env-file=.env');
  process.exit(1);
}
if (!phoneNumberId) {
  console.error('No phone number id: pass --phone-number-id or set WHATSAPP_PHONE_NUMBER_ID');
  process.exit(1);
}

let value;
if (args.status) {
  value = {
    statuses: [
      { id: wamid, status: String(args.status), timestamp: now, recipient_id: from },
    ],
  };
} else {
  const message =
    args.type === 'voice'
      ? {
          from,
          id: wamid,
          timestamp: now,
          type: 'audio',
          audio: { id: `PROBE_MEDIA_${Date.now()}`, mime_type: 'audio/ogg; codecs=opus', voice: true },
        }
      : {
          from,
          id: wamid,
          timestamp: now,
          type: 'text',
          text: { body: String(args.text ?? `Probe message ${new Date().toLocaleTimeString()}`) },
        };
  value = {
    contacts: [{ profile: { name: String(args.name ?? 'Probe Customer') }, wa_id: from }],
    messages: [message],
  };
}

const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '0',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '0', phone_number_id: phoneNumberId },
            ...value,
          },
        },
      ],
    },
  ],
});

const signature = args['bad-signature']
  ? `sha256=${'0'.repeat(64)}`
  : `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const res = await fetch(`${base}/api/whatsapp/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  body,
});
console.log(`${res.status} ${await res.text()}`);
console.log(`wamid=${wamid} phone_number_id=${phoneNumberId} from=${from}`);
if (res.ok && !args.status) {
  console.log(
    'The message lands only if this phone_number_id is connected to a company — otherwise the server logs "webhook for unconnected phone_number_id".',
  );
}
