/**
 * Does a SIP REGISTER actually succeed against SignalWire with our credentials?
 *
 * READ-ONLY in effect: it registers a contact at a bogus `.invalid` host and lets it
 * expire, so nothing can be routed to it.
 *
 * This exists to split one ambiguous failure into two distinct ones. The inbound
 * `<Dial><Sip>` leg fails instantly with `sip_result_code: null` and `start_time: null`
 * — meaning no SIP transaction happened at all, which is what "no registered contact"
 * looks like. But that is equally consistent with "the browser never registered" and
 * with "registration is impossible with these credentials". Only one of those is a
 * code problem, and they need opposite fixes.
 *
 *   node scripts/sip-register-probe.mjs <username> <password> [domain]
 *
 * Hand-rolled WebSocket framing rather than a dependency: `ws` is not installed on the
 * server and this is a throwaway diagnostic.
 */

import tls from 'node:tls';
import crypto from 'node:crypto';

const [, , USER, PASS, DOMAIN = 'cygfinance.sip.signalwire.com'] = process.argv;
if (!USER || !PASS) {
  console.error('usage: node sip-register-probe.mjs <username> <password> [domain]');
  process.exit(1);
}

const rand = (n = 8) => crypto.randomBytes(n).toString('hex');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const callId = rand(12);
const fromTag = rand(6);
// A contact at `.invalid` is the SIP convention for a WebSocket client with no routable
// address of its own. It also guarantees this probe can never receive a real call.
const contact = `<sip:${USER}@${rand(8)}.invalid;transport=ws>`;

let cseq = 1;

function register(authHeader) {
  const branch = `z9hG4bK${rand(6)}`;
  const lines = [
    `REGISTER sip:${DOMAIN} SIP/2.0`,
    `Via: SIP/2.0/WSS ${rand(8)}.invalid;branch=${branch}`,
    'Max-Forwards: 70',
    `To: <sip:${USER}@${DOMAIN}>`,
    `From: <sip:${USER}@${DOMAIN}>;tag=${fromTag}`,
    `Call-ID: ${callId}`,
    `CSeq: ${cseq} REGISTER`,
    `Contact: ${contact};expires=60`,
    'Expires: 60',
    'User-Agent: cyg-sip-probe',
    ...(authHeader ? [`Authorization: ${authHeader}`] : []),
    'Content-Length: 0',
    '',
    '',
  ];
  return lines.join('\r\n');
}

/** Client-to-server WebSocket frames MUST be masked (RFC 6455 §5.3). */
function wsFrame(payload) {
  const data = Buffer.from(payload, 'utf-8');
  const mask = crypto.randomBytes(4);
  const len = data.length;

  let header;
  if (len < 126) {
    header = Buffer.from([0x81, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** Minimal unmasked server-frame reader — enough for text frames. */
function readFrames(buf) {
  const out = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const opcode = buf[off] & 0x0f;
    let len = buf[off + 1] & 0x7f;
    let pos = off + 2;
    if (len === 126) {
      if (pos + 2 > buf.length) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    if (pos + len > buf.length) break;
    if (opcode === 0x1) out.push(buf.subarray(pos, pos + len).toString('utf-8'));
    off = pos + len;
  }
  return { frames: out, rest: buf.subarray(off) };
}

/** Parses `Digest realm="x", nonce="y"` into an object. */
function parseChallenge(header) {
  const out = {};
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

function digestAuth(ch, uri) {
  const ha1 = md5(`${USER}:${ch.realm}:${PASS}`);
  const ha2 = md5(`REGISTER:${uri}`);
  const parts = [
    `Digest username="${USER}"`,
    `realm="${ch.realm}"`,
    `nonce="${ch.nonce}"`,
    `uri="${uri}"`,
  ];
  let responseValue;
  if (ch.qop) {
    const cnonce = rand(8);
    const nc = '00000001';
    responseValue = md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${ch.qop}:${ha2}`);
    parts.push(`qop=${ch.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  } else {
    responseValue = md5(`${ha1}:${ch.nonce}:${ha2}`);
  }
  parts.push(`response="${responseValue}"`);
  // Echo the algorithm when the challenge advertises it. Some registrars reject an
  // otherwise-correct response without it, which presents as "bad password" and sends
  // you looking in entirely the wrong place.
  if (ch.algorithm) parts.push(`algorithm=${ch.algorithm}`);
  if (ch.opaque) parts.push(`opaque="${ch.opaque}"`);
  return parts.join(', ');
}

const wsKey = crypto.randomBytes(16).toString('base64');
let upgraded = false;
let pending = Buffer.alloc(0);
let challenged = false;

const sock = tls.connect({ host: DOMAIN, port: 443, servername: DOMAIN }, () => {
  sock.write(
    [
      'GET / HTTP/1.1',
      `Host: ${DOMAIN}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: sip',
      'Origin: https://internal.cygfinance.com',
      '',
      '',
    ].join('\r\n'),
  );
});

sock.on('data', (chunk) => {
  // One buffer, appended exactly once per chunk. Appending again after the
  // upgrade branch (as this did) replays the HTTP header bytes into the frame
  // parser, and every frame after that is garbage.
  pending = Buffer.concat([pending, chunk]);

  if (!upgraded) {
    const split = pending.indexOf('\r\n\r\n');
    if (split === -1) return;
    const head = pending.subarray(0, split).toString();
    if (!head.startsWith('HTTP/1.1 101')) {
      console.log('WS UPGRADE FAILED:\n' + head);
      process.exit(0);
    }
    console.log('websocket: 101 Switching Protocols');
    upgraded = true;
    pending = pending.subarray(split + 4);
    console.log(`--> REGISTER (unauthenticated) as ${USER}@${DOMAIN}`);
    sock.write(wsFrame(register(null)));
  }

  const { frames, rest } = readFrames(pending);
  pending = rest;

  for (const msg of frames) {
    const status = msg.split('\r\n')[0];
    if (!status.startsWith('SIP/2.0')) continue;
    console.log('<-- ' + status);

    if (/^SIP\/2\.0 401|^SIP\/2\.0 407/.test(status) && !challenged) {
      challenged = true;
      const m = msg.match(/(?:WWW|Proxy)-Authenticate:\s*(.+)/i);
      if (!m) {
        console.log('!! challenge with no Authenticate header');
        process.exit(0);
      }
      const ch = parseChallenge(m[1]);
      console.log(`    realm=${ch.realm} qop=${ch.qop ?? '(none)'}`);
      cseq++;
      console.log('--> REGISTER (with digest)');
      sock.write(wsFrame(register(digestAuth(ch, `sip:${DOMAIN}`))));
    } else if (/^SIP\/2\.0 200/.test(status)) {
      console.log('*** REGISTER SUCCEEDED ***');
      const contact = msg.match(/^Contact:[ 	]*(.+)$/im);
      if (contact) console.log('registrar-held contacts: ' + contact[1]);
      if (process.env.HOLD) {
        // Stay registered so a SECOND client can register the SAME credential and we
        // can observe whether an inbound call forks to both contacts or only the last.
        console.log('holding registration open (HOLD set)');
        return;
      }
      process.exit(0);
    } else if (/^SIP\/2\.0 [45]/.test(status) && challenged) {
      console.log('\n*** REGISTER REJECTED after auth — credentials or config wrong. ***');
      console.log(msg.split('\r\n').slice(0, 12).join('\n'));
      process.exit(0);
    }
  }
});

sock.on('error', (e) => {
  console.log('socket error:', e.message);
  process.exit(0);
});

setTimeout(() => {
  console.log('\n*** TIMEOUT — no SIP response. The registrar is not answering. ***');
  process.exit(0);
}, 12_000);
