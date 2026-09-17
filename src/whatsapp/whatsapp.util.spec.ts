import { createHmac } from 'crypto';
import {
  TEMPLATE_CATEGORIES,
  WHATSAPP_MEDIA_MAX_BYTES,
  buildTemplateComponents,
  isSendableTemplate,
  isValidTemplateLanguage,
  isValidTemplateName,
  extractSpokenCode,
  shouldRetryByVoice,
  WHATSAPP_VOICE_ARGS,
  whatsappAcceptsCaption,
  whatsappMediaKind,
  countTemplateVariables,
  extractWhatsAppCode,
  friendlyGraphMessage,
  graphErrorOf,
  isWindowOpen,
  mediaFilename,
  nextDeliveryStatus,
  normalizeWaId,
  parseWaTimestamp,
  parseWebhook,
  renderTemplateBody,
  splitNanpNumber,
  templateComponents,
  toDisplayName,
  toTemplate,
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
  it("reads WhatsApp's native quote off context.id", () => {
    const [change] = parseWebhook(
      delivery({
        messages: [
          {
            from: '15145550000',
            id: 'wamid.B',
            timestamp: '1757851200',
            type: 'text',
            text: { body: 'yes please' },
            context: { from: '14382561210', id: 'wamid.A' },
          },
        ],
      }),
      NOW,
    );
    expect(change.messages[0]).toMatchObject({
      wamid: 'wamid.B',
      replyToWamid: 'wamid.A',
    });
  });

  it('leaves replyToWamid null on a message that is not a reply', () => {
    const [change] = parseWebhook(
      delivery({
        messages: [
          {
            from: '15145550000',
            id: 'wamid.C',
            timestamp: '1757851200',
            type: 'text',
            text: { body: 'hello' },
          },
        ],
      }),
      NOW,
    );
    expect(change.messages[0].replyToWamid).toBeNull();
  });

  it('carries the quote on a non-text reply too', () => {
    // A reply can be a photo or a voice note; the field is read on the shared base, so
    // every per-type branch inherits it.
    const [change] = parseWebhook(
      delivery({
        messages: [
          {
            from: '15145550000',
            id: 'wamid.D',
            timestamp: '1757851200',
            type: 'image',
            image: { id: 'media-1', mime_type: 'image/jpeg' },
            context: { id: 'wamid.A' },
          },
        ],
      }),
      NOW,
    );
    expect(change.messages[0]).toMatchObject({
      type: 'image',
      replyToWamid: 'wamid.A',
    });
  });

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

describe('template variables', () => {
  it('counts by HIGHEST index, not by occurrences', () => {
    // A body may repeat a placeholder; Meta still wants exactly one parameter for it.
    // Counting occurrences would send two and be rejected.
    expect(countTemplateVariables('Hi {{1}}, thanks {{1}}')).toBe(1);
    expect(countTemplateVariables('Hi {{1}}, re {{2}}')).toBe(2);
    // A gap still means two parameters — they are positional.
    expect(countTemplateVariables('Only {{2}}')).toBe(2);
  });

  it('counts nothing in a body with no placeholders', () => {
    expect(countTemplateVariables('Your documents are ready.')).toBe(0);
  });

  it('tolerates the spaced form Meta sometimes stores', () => {
    expect(countTemplateVariables('Hi {{ 1 }}')).toBe(1);
  });
});

describe('renderTemplateBody', () => {
  it('fills placeholders positionally', () => {
    expect(
      renderTemplateBody('Hi {{1}}, re {{2}}.', ['Chaim', 'your T2']),
    ).toBe('Hi Chaim, re your T2.');
  });

  it('fills every occurrence of a repeated placeholder', () => {
    expect(renderTemplateBody('{{1}} — bye {{1}}', ['Yo'])).toBe('Yo — bye Yo');
  });

  /**
   * This text is the only record of what the customer received — Meta sends the real
   * message from its own copy — so a missing value must be VISIBLE rather than read as a
   * sentence somebody meant to write.
   */
  it('leaves a missing or empty variable as its placeholder', () => {
    expect(renderTemplateBody('Hi {{1}}, re {{2}}.', ['Chaim'])).toBe(
      'Hi Chaim, re {{2}}.',
    );
    expect(renderTemplateBody('Hi {{1}}.', [''])).toBe('Hi {{1}}.');
  });

  it('ignores extra variables', () => {
    expect(renderTemplateBody('Hi {{1}}.', ['A', 'B'])).toBe('Hi A.');
  });
});

describe('templateComponents', () => {
  it('omits the components array entirely when there are no variables', () => {
    // Meta rejects an empty `components` array on a template with no parameters.
    expect(templateComponents([])).toEqual([]);
  });

  it('shapes the body parameters the way Meta expects', () => {
    expect(templateComponents(['A', 'B'])).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
        ],
      },
    ]);
  });
});

describe('toTemplate', () => {
  const raw = {
    name: 'file_ready',
    language: 'en_US',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', text: 'CygFinance' },
      { type: 'BODY', text: 'Hi {{1}}, your file is ready.' },
    ],
  };

  it('flattens the BODY component and counts its variables', () => {
    expect(toTemplate(raw)).toEqual({
      id: null,
      name: 'file_ready',
      language: 'en_US',
      category: 'UTILITY',
      body: 'Hi {{1}}, your file is ready.',
      variableCount: 1,
      status: 'APPROVED',
      rejectedReason: null,
    });
  });

  /**
   * ⚠️ Carrying the STATUS is what lets a template somebody just submitted be visible
   * while Meta reviews it — the whole point of being able to create one from the app.
   * Meta returns every state; the APPROVED-only filter was ours.
   */
  it('carries the review status and the rejection reason', () => {
    expect(
      toTemplate({
        ...raw,
        id: '123',
        status: 'REJECTED',
        rejected_reason: 'INVALID_FORMAT',
      }),
    ).toMatchObject({
      id: '123',
      status: 'REJECTED',
      rejectedReason: 'INVALID_FORMAT',
    });
    expect(toTemplate({ ...raw, status: 'PENDING' })).toMatchObject({
      status: 'PENDING',
    });
  });

  /**
   * It used to return null here, which was harmless while only APPROVED templates were
   * listed. Now it would hide a pending submission — exactly what this change fixes — so
   * a body-less template is LISTED with a null body and refused at selection instead.
   */
  it('keeps a template with no body, rather than hiding it', () => {
    expect(
      toTemplate({ ...raw, components: [{ type: 'HEADER', text: 'x' }] }),
    ).toMatchObject({ body: null, variableCount: 0 });
    expect(toTemplate({ ...raw, components: undefined })).toMatchObject({
      body: null,
    });
  });

  it('drops one missing a name or a language', () => {
    expect(toTemplate({ ...raw, name: undefined })).toBeNull();
    expect(toTemplate({ ...raw, language: '  ' })).toBeNull();
  });
});

describe('whatsappMediaKind', () => {
  it('recognises the types WhatsApp renders natively', () => {
    expect(whatsappMediaKind('image/jpeg', 'photo.jpg')).toBe('image');
    expect(whatsappMediaKind('image/png', 'shot.png')).toBe('image');
    expect(whatsappMediaKind('video/mp4', 'clip.mp4')).toBe('video');
    expect(whatsappMediaKind('video/3gpp', 'clip.3gp')).toBe('video');
    expect(whatsappMediaKind('audio/mpeg', 'song.mp3')).toBe('audio');
    expect(whatsappMediaKind('audio/ogg; codecs=opus', 'note.ogg')).toBe(
      'audio',
    );
  });

  /**
   * The reason this is an allow-list and not `startsWith('image/')`. Meta REJECTS a GIF
   * sent as an image, and webp is sticker-only with a 500 KB cap and an aspect requirement
   * no ordinary attachment meets — as documents, both simply arrive.
   */
  it('sends a GIF and a WEBP as documents, not images', () => {
    expect(whatsappMediaKind('image/gif', 'funny.gif')).toBe('document');
    expect(whatsappMediaKind('image/webp', 'sticker.webp')).toBe('document');
  });

  it('falls back to document for everything else — which is what makes "any file" true', () => {
    expect(whatsappMediaKind('application/pdf', 'invoice.pdf')).toBe(
      'document',
    );
    expect(whatsappMediaKind('application/zip', 'books.zip')).toBe('document');
    expect(whatsappMediaKind('text/csv', 'ledger.csv')).toBe('document');
    expect(whatsappMediaKind(null, 'mystery')).toBe('document');
    expect(whatsappMediaKind('', '')).toBe('document');
  });

  /**
   * `mimetype` is whatever the browser declared, so it cannot be the only word on the
   * subject. A disagreement demotes rather than throws: plenty of harmless files carry a
   * vague type, and a document is always deliverable.
   */
  it('demotes a file whose extension contradicts its declared type', () => {
    expect(whatsappMediaKind('image/png', 'payload.exe')).toBe('document');
    expect(whatsappMediaKind('image/jpeg', 'clip.mp4')).toBe('document');
    expect(whatsappMediaKind('audio/mpeg', 'photo.png')).toBe('document');
  });

  it('demotes an extension it does not recognise — that is the dangerous case', () => {
    // `.exe` is not "no opinion", it is an unverifiable claim. Only a file with NO
    // extension has nothing to corroborate, and it keeps its declared type.
    expect(whatsappMediaKind('image/jpeg', 'scan.jfif')).toBe('document');
    expect(whatsappMediaKind('image/jpeg', 'scan')).toBe('image');
  });

  it('is case-insensitive about both halves', () => {
    expect(whatsappMediaKind('IMAGE/JPEG', 'PHOTO.JPG')).toBe('image');
  });
});

describe('whatsapp media limits', () => {
  it('caps each kind at Meta’s ceiling, documents highest', () => {
    expect(WHATSAPP_MEDIA_MAX_BYTES.image).toBe(5 * 1024 * 1024);
    expect(WHATSAPP_MEDIA_MAX_BYTES.video).toBe(16 * 1024 * 1024);
    expect(WHATSAPP_MEDIA_MAX_BYTES.audio).toBe(16 * 1024 * 1024);
    expect(WHATSAPP_MEDIA_MAX_BYTES.document).toBe(100 * 1024 * 1024);
  });

  it('offers a caption only where WhatsApp shows one', () => {
    expect(whatsappAcceptsCaption('image')).toBe(true);
    expect(whatsappAcceptsCaption('video')).toBe(true);
    expect(whatsappAcceptsCaption('document')).toBe(true);
    // Typing a sentence that silently never arrives is worse than no field.
    expect(whatsappAcceptsCaption('audio')).toBe(false);
    expect(whatsappAcceptsCaption('sticker')).toBe(false);
  });
});

describe('extractSpokenCode', () => {
  /**
   * This reads a TRANSCRIPT of Meta reading the code aloud, which is why it cannot be
   * `extractWhatsAppCode`: that one demands the literal word "WhatsApp" (speech-to-text
   * mangles it) and a `\d{3}[-\s]?\d{3}` shape (a spoken code has neither).
   */
  it('reads a code however the transcript renders it', () => {
    expect(extractSpokenCode('Your WhatsApp code is 493021')).toBe('493021');
    expect(extractSpokenCode('your code is 493-021')).toBe('493021');
    expect(extractSpokenCode('4 9 3 0 2 1')).toBe('493021');
    expect(extractSpokenCode('four nine three zero two one')).toBe('493021');
    expect(extractSpokenCode('4 9 3 zero two one')).toBe('493021');
    expect(
      extractSpokenCode('The code is four, nine, three, oh, two, one.'),
    ).toBe('493021');
  });

  /** The robot reads it twice, and agreement is the confirmation it was heard right. */
  it('accepts the repeat, which is what makes it a confirmation', () => {
    expect(
      extractSpokenCode(
        'Your code is 493021. Again, your code is 4 9 3 0 2 1.',
      ),
    ).toBe('493021');
  });

  /**
   * ⚠️ The rule that stops a stray number reaching Meta. `register` is capped at 10
   * attempts per 72 hours, so guessing between two readings is expensive.
   */
  it('refuses when two different six-digit numbers appear', () => {
    expect(extractSpokenCode('code 493021 or maybe 111222')).toBeNull();
  });

  it('refuses a run that is not exactly six digits, rather than trimming it', () => {
    expect(extractSpokenCode('call 5145551234')).toBeNull();
    expect(extractSpokenCode('code 4930')).toBeNull();
    expect(extractSpokenCode('reference 4930219')).toBeNull();
  });

  it('never reads a homophone as a digit', () => {
    // "for", "to", "ate", "won" are not digits — a wrong code costs an attempt.
    expect(extractSpokenCode('for to ate won for to')).toBeNull();
  });

  it('survives junk', () => {
    expect(extractSpokenCode('')).toBeNull();
    expect(extractSpokenCode('   ')).toBeNull();
    expect(extractSpokenCode(null)).toBeNull();
    expect(extractSpokenCode(undefined)).toBeNull();
    expect(extractSpokenCode(493021 as unknown)).toBeNull();
  });
});

describe('shouldRetryByVoice', () => {
  /**
   * A voice call is a different DELIVERY path, so it is worth trying when a text could
   * not be delivered — and worth nothing when the request itself was refused.
   */
  it('retries a delivery failure', () => {
    expect(shouldRetryByVoice(136024)).toBe(true);
    expect(shouldRetryByVoice(null)).toBe(true);
  });

  it('does not retry a revoked token, a throttle or an attempt ceiling', () => {
    expect(shouldRetryByVoice(190)).toBe(false);
    expect(shouldRetryByVoice(133016)).toBe(false);
    expect(shouldRetryByVoice(131048)).toBe(false);
    // Already on the WABA is not a delivery problem at all.
    expect(shouldRetryByVoice(2388012)).toBe(false);
  });
});

describe('template submission rules', () => {
  /**
   * Each of these is a Meta 400 whose wording does not say what is wrong, which is why
   * they are checked before the round trip rather than after it.
   */
  it('accepts only lowercase names — Meta rejects uppercase rather than folding it', () => {
    expect(isValidTemplateName('appointment_reminder')).toBe(true);
    expect(isValidTemplateName('receipt_2026')).toBe(true);
    expect(isValidTemplateName('Appointment_Reminder')).toBe(false);
    expect(isValidTemplateName('appointment reminder')).toBe(false);
    expect(isValidTemplateName('appointment-reminder')).toBe(false);
    expect(isValidTemplateName('')).toBe(false);
  });

  it('wants a LOCALE, not a BCP-47 tag — one character apart', () => {
    expect(isValidTemplateLanguage('en_US')).toBe(true);
    expect(isValidTemplateLanguage('fr')).toBe(true);
    expect(isValidTemplateLanguage('en-US')).toBe(false);
    expect(isValidTemplateLanguage('EN_US')).toBe(false);
  });

  /**
   * AUTHENTICATION is absent on purpose: Meta fixes its component shape (a one-time-code
   * button, no free body), so the body-and-variables form here cannot produce a valid
   * submission for it.
   */
  it('offers only the categories this app can actually build', () => {
    expect([...TEMPLATE_CATEGORIES]).toEqual(['UTILITY', 'MARKETING']);
  });

  it('sends no example for a body with no placeholders', () => {
    expect(buildTemplateComponents('Your receipt is attached.')).toEqual([
      { type: 'BODY', text: 'Your receipt is attached.' },
    ]);
  });

  /**
   * ⚠️ `body_text` is an ARRAY OF ARRAYS — one inner array per example SET, not one per
   * variable. Meta rejects the other shape, and the error reads like a schema complaint.
   */
  it('wraps examples in the array-of-arrays shape Meta demands', () => {
    expect(
      buildTemplateComponents('Hi {{1}}, your {{2}} is ready.', [
        'Dana',
        'return',
      ]),
    ).toEqual([
      {
        type: 'BODY',
        text: 'Hi {{1}}, your {{2}} is ready.',
        example: { body_text: [['Dana', 'return']] },
      },
    ]);
  });

  it('fills a missing example with a visible stand-in rather than a blank', () => {
    // Meta refuses an empty example, and a reviewer reading "Hi ," learns nothing.
    const [component] = buildTemplateComponents('Hi {{1}}, re {{2}}.', [
      'Dana',
    ]) as [{ example: { body_text: string[][] } }];
    expect(component.example.body_text).toEqual([['Dana', 'example2']]);
  });

  /** The count is the highest index, so a repeated {{1}} still needs exactly one value. */
  it('asks for one example per distinct placeholder, not per occurrence', () => {
    const [component] = buildTemplateComponents('{{1}} and {{1}} again', [
      'once',
    ]) as [{ example: { body_text: string[][] } }];
    expect(component.example.body_text).toEqual([['once']]);
  });

  it('treats only APPROVED as sendable', () => {
    expect(isSendableTemplate('APPROVED')).toBe(true);
    for (const s of [
      'PENDING',
      'REJECTED',
      'PAUSED',
      'DISABLED',
      undefined,
      null,
    ]) {
      expect(isSendableTemplate(s)).toBe(false);
    }
  });
});
