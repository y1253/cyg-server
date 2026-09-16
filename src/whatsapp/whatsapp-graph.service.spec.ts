import { WhatsAppGraphService } from './whatsapp-graph.service';

/**
 * The exact JSON each send puts on the wire.
 *
 * Worth pinning because `sendAudio` is now pure composition over `sendMedia`, and the one
 * thing still unverified about voice notes is whether an Ogg/Opus upload renders with a
 * WAVEFORM rather than as a plain audio file. If a refactor quietly added a field, a
 * regression there would be indistinguishable from that open question — which is exactly
 * the trap `laml.util.ts` documents for its own verb fragments.
 */
function setup() {
  const service = new WhatsAppGraphService();
  const sent: unknown[] = [];
  // `call` is private; the payload it is handed is the contract under test.
  (service as unknown as { call: unknown }).call = jest
    .fn()
    .mockImplementation((_label: string, _path: string, init: { json?: unknown }) => {
      sent.push(init.json);
      return Promise.resolve({ messages: [{ id: 'wamid.X' }] });
    });
  return { service, sent };
}

describe('sendMedia', () => {
  it('sends a voice note byte-identically to the shape that predates sendMedia', async () => {
    const { service, sent } = setup();
    await service.sendAudio('PN', 'tok', '15145550000', 'MEDIA');
    expect(sent[0]).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15145550000',
      type: 'audio',
      audio: { id: 'MEDIA' },
    });
  });

  it('names the inner object after the kind, as Meta expects', async () => {
    const { service, sent } = setup();
    await service.sendMedia('PN', 'tok', '1', 'image', 'M');
    await service.sendMedia('PN', 'tok', '1', 'video', 'M');
    expect(sent[0]).toMatchObject({ type: 'image', image: { id: 'M' } });
    expect(sent[1]).toMatchObject({ type: 'video', video: { id: 'M' } });
  });

  it('carries a caption on an image and a filename on a document', async () => {
    const { service, sent } = setup();
    await service.sendMedia('PN', 'tok', '1', 'image', 'M', {
      caption: 'the receipt',
      filename: 'receipt.jpg',
    });
    await service.sendMedia('PN', 'tok', '1', 'document', 'M', {
      caption: 'Q3',
      filename: 'ledger.pdf',
    });
    // `filename` is document-only — Meta ignores it elsewhere.
    expect(sent[0]).toMatchObject({ image: { id: 'M', caption: 'the receipt' } });
    expect(sent[0]).not.toMatchObject({ image: { filename: expect.anything() } });
    expect(sent[1]).toMatchObject({
      document: { id: 'M', caption: 'Q3', filename: 'ledger.pdf' },
    });
  });

  /**
   * Dropped rather than sent-and-ignored. Meta accepts the message and silently discards
   * the caption, so a half-success would look like a delivered sentence that the recipient
   * never sees — the composer disables the field for these kinds for the same reason.
   */
  it('drops a caption on audio, which cannot show one', async () => {
    const { service, sent } = setup();
    await service.sendMedia('PN', 'tok', '1', 'audio', 'M', { caption: 'hi' });
    expect(sent[0]).toMatchObject({ audio: { id: 'M' } });
    expect(JSON.stringify(sent[0])).not.toContain('caption');
  });

  it('quotes the message being replied to, and omits context otherwise', async () => {
    const { service, sent } = setup();
    await service.sendMedia('PN', 'tok', '1', 'image', 'M', {
      replyToWamid: 'wamid.PARENT',
    });
    await service.sendMedia('PN', 'tok', '1', 'image', 'M');
    expect(sent[0]).toMatchObject({ context: { message_id: 'wamid.PARENT' } });
    expect(JSON.stringify(sent[1])).not.toContain('context');
  });
});
