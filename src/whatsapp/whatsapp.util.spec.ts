import { createHmac } from 'crypto';
import {
  WHATSAPP_VOICE_ARGS,
  extractWhatsAppCode,
  friendlyGraphMessage,
  graphErrorOf,
  isWindowOpen,
  mediaFilename,
  nextDeliveryStatus,
  normalizeWaId,
  parseWaTimestamp,
  parseWebhook,
  splitNanpNumber,
  toDisplayName,
  verifyMetaSignature,
  whatsappConfig,
  whatsappPreview,
} from './whatsapp.util';

const NOW = new Date('2026-09-14T12:00:00.000Z');

describe("extractWhatsAppCode — reading Meta's verification text", () => {
  it('reads a hyphenated code', () => {
    expect(
      extractWhatsAppCode(
        "Your WhatsApp Business code 123-456. Don't share this code with others",
      ),
    ).toBe('123456');
  });

  it('reads a plain six-digit code', () => {
    expect(extractWhatsAppCode('WhatsApp code: 654321')).toBe('654321');
  });

  it('ignores a text that does not mention WhatsApp', () => {
    // A client texting a reference number must never be sent to Meta as a code.
    expect(extractWhatsAppCode('Call me back on 514-555 please')).toBeNull();
  });

  it('refuses five and seven digit runs', () => {
    expect(extractWhatsAppCode('WhatsApp code 12345')).toBeNull();
    expect(extractWhatsAppCode('WhatsApp code 1234567')).toBeNull();
  });

  it('returns null for a missing body', () => {
    expect(extractWhatsAppCode(undefined)).toBeNull();
  });
});

describe('splitNanpNumber', () => {
  it('splits a +1 number into what Meta takes', () => {
    expect(splitNanpNumber('+15145551234')).toEqual({
      cc: '1',
      number: '5145551234',
    });
  });

  it('refuses anything that is not a ten-digit +1 number', () => {
    expect(splitNanpNumber('+445145551234')).toBeNull();
    expect(splitNanpNumber('5145551234')).toBeNull();
    expect(splitNanpNumber(null)).toBeNull();
  });
});

describe('toDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(toDisplayName('  Acme   Inc ')).toBe('Acme Inc');
  });

  it('caps a very long name', () => {
    expect(toDisplayName('x'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe('friendlyGraphMessage — the number-limit wording', () => {
  it('explains the 2-number cap rather than passing Meta through', () => {
    expect(
      friendlyGraphMessage(
        null,
        'You have already linked the maximum number of phone numbers allowed for this Business Account',
      ),
    ).toMatch(/business verification/);
  });
});

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function delivery(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551716151',
                phone_number_id: '1328048100389332',
              },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

describe('verifyMetaSignature', () => {
  const body = JSON.stringify({ hello: 'world' });

  it('accepts a signature over the raw body', () => {
    expect(
      verifyMetaSignature(Buffer.from(body), sign(body, 'shh'), 'shh'),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyMetaSignature(
        Buffer.from(body.replace('world', 'w0rld')),
        sign(body, 'shh'),
        'shh',
      ),
    ).toBe(false);
  });

  it('fails CLOSED when the secret is not configured', () => {
    expect(verifyMetaSignature(Buffer.from(body), sign(body, ''), null)).toBe(
      false,
    );
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyMetaSignature(Buffer.from(body), undefined, 'shh')).toBe(
      false,
    );
    expect(verifyMetaSignature(Buffer.from(body), 'sha256=zz', 'shh')).toBe(
      false,
    );
    expect(verifyMetaSignature(undefined, sign(body, 'shh'), 'shh')).toBe(
      false,
    );
  });
});

describe('whatsappConfig', () => {
  it('skips blank values instead of returning an empty token', () => {
    const cfg = whatsappConfig({ WHATSAPP_TOKEN: '', WHATSAPP_ID: ' 123 ' });
    expect(cfg.firmToken).toBeNull();
    expect(cfg.appId).toBe('123');
    expect(cfg.graphVersion).toBe('v23.0');
  });
});

describe('normalizeWaId', () => {
  it('keeps digits from a typed number', () => {
    expect(normalizeWaId('+1 (555) 171-6151')).toBe('15551716151');
  });

  it('rejects text with letters rather than scavenging its digits', () => {
    expect(normalizeWaId('call 5551716151 now')).toBeNull();
    expect(normalizeWaId('123')).toBeNull();
    expect(normalizeWaId(undefined)).toBeNull();
  });
});

describe('parseWaTimestamp', () => {
  it('reads Unix seconds', () => {
    expect(parseWaTimestamp('1757851200', NOW).toISOString()).toBe(
      '2025-09-14T12:00:00.000Z',
    );
  });

  it('falls back to the receive time, never epoch 0', () => {
    expect(parseWaTimestamp('garbage', NOW)).toBe(NOW);
    expect(parseWaTimestamp('0', NOW)).toBe(NOW);
    expect(parseWaTimestamp(undefined, NOW)).toBe(NOW);
  });
});

describe('parseWebhook', () => {
  it('parses a text message with the sender profile name', () => {
    const [change] = parseWebhook(
      delivery({
        contacts: [{ profile: { name: 'Jane' }, wa_id: '15145550000' }],
        messages: [
          {
            from: '15145550000',
            id: 'wamid.A',
            timestamp: '1757851200',
            type: 'text',
            text: { body: 'Hi there' },
          },
        ],
      }),
      NOW,
    );
    expect(change.phoneNumberId).toBe('1328048100389332');
    expect(change.messages).toEqual([
      expect.objectContaining({
        wamid: 'wamid.A',
        from: '15145550000',
        profileName: 'Jane',
        type: 'text',
        body: 'Hi there',
        mediaId: null,
        isVoice: false,
      }),
    ]);
  });

  it('parses an image with a caption', () => {
    const [change] = parseWebhook(
      delivery({
        messages: [
          {
            from: '15145550000',
            id: 'wamid.B',
            timestamp: '1757851200',
            type: 'image',
            image: {
              id: 'MEDIA1',
              mime_type: 'image/jpeg',
              caption: 'receipt',
            },
          },
        ],
      }),
      NOW,
    );
    expect(change.messages[0]).toEqual(
      expect.objectContaining({
        type: 'image',
        body: 'receipt',
        mediaId: 'MEDIA1',
        mimeType: 'image/jpeg',
      }),
    );
  });

  it('marks a push-to-talk audio as a voice note, and a plain audio file as not', () => {
    const [change] = parseWebhook(
      delivery({
        messages: [
          {
            from: '15145550000',
            id: 'wamid.V',
            timestamp: '1757851200',
            type: 'audio',
            audio: {
              id: 'MEDIA2',
              mime_type: 'audio/ogg; codecs=opus',
              voice: true,
            },
          },
          {
            from: '15145550000',
            id: 'wamid.F',
            timestamp: '1757851200',
            type: 'audio',
            audio: { id: 'MEDIA3', mime_type: 'audio/mpeg' },
          },
        ],
      }),
      NOW,
    );
    expect(change.messages.map((m) => [m.wamid, m.isVoice])).toEqual([
      ['wamid.V', true],
      ['wamid.F', false],
    ]);
  });

  it('keeps an unknown type as an unsupported row instead of dropping it', () => {
    const [change] = parseWebhook(
      delivery({
        messages: [
          {
            from: '15145550000',
            id: 'wamid.U',
            timestamp: '1757851200',
            type: 'ephemeral',
          },
        ],
      }),
      NOW,
    );
    expect(change.messages[0]).toEqual(
      expect.objectContaining({ type: 'unsupported', body: null }),
    );
  });

  it('parses statuses and their error code', () => {
    const [change] = parseWebhook(
      delivery({
        statuses: [
          { id: 'wamid.S', status: 'delivered', timestamp: '1757851200' },
          {
            id: 'wamid.T',
            status: 'failed',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.X', status: 'deleted' },
        ],
      }),
      NOW,
    );
    expect(change.statuses).toEqual([
      { wamid: 'wamid.S', status: 'delivered', errorCode: null },
      { wamid: 'wamid.T', status: 'failed', errorCode: '131047' },
    ]);
  });

  it('ignores anything that is not a WhatsApp delivery', () => {
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe('nextDeliveryStatus', () => {
  it('only moves forward', () => {
    expect(nextDeliveryStatus('read', 'delivered')).toBe('read');
    expect(nextDeliveryStatus('sent', 'read')).toBe('read');
    expect(nextDeliveryStatus(null, 'sent')).toBe('sent');
  });

  it('treats failed as terminal', () => {
    expect(nextDeliveryStatus('failed', 'read')).toBe('failed');
    expect(nextDeliveryStatus('delivered', 'failed')).toBe('failed');
  });
});

describe('isWindowOpen', () => {
  it('is open for 24h after the last inbound message, and closed after', () => {
    const last = new Date('2026-09-13T12:00:00.001Z');
    expect(isWindowOpen(last, NOW)).toBe(true);
    expect(isWindowOpen(new Date('2026-09-13T12:00:00.000Z'), NOW)).toBe(false);
    expect(isWindowOpen(null, NOW)).toBe(false);
  });
});

describe('graphErrorOf', () => {
  it('prefers the user-facing message', () => {
    expect(
      graphErrorOf({
        error: {
          message: 'Invalid parameter',
          error_user_msg: 'Pick a number',
          code: 100,
          error_subcode: 2,
        },
      }),
    ).toEqual({ message: 'Pick a number', code: 100, subcode: 2 });
    expect(graphErrorOf({ data: [] })).toBeNull();
  });
});

describe('media helpers', () => {
  it('names an unnamed voice note', () => {
    expect(mediaFilename('audio', null, 7, 'audio/ogg; codecs=opus')).toBe(
      'whatsapp-voice-7.ogg',
    );
    expect(mediaFilename('document', 'invoice.pdf', 7, 'application/pdf')).toBe(
      'invoice.pdf',
    );
  });

  it('labels a message with no text', () => {
    expect(whatsappPreview('audio', null, true)).toBe('Voice message');
    expect(whatsappPreview('image', 'receipt', false)).toBe('receipt');
  });

  it('pins the voice-note encoding (Opus in Ogg, mono)', () => {
    expect(WHATSAPP_VOICE_ARGS).toEqual([
      '-vn',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-f',
      'ogg',
    ]);
  });
});
