import { MicrosoftService } from './microsoft.service';
import type { GraphMessage } from './graph.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessageStateService } from '../communications/message-state.service';
import type { EmailSummaryDto } from '../communications/communications.types';

/**
 * The Outlook half of the Drafts folder.
 *
 * Two failures here are silent rather than loud, which is why they are pinned:
 *
 * - A missing `drafts` case in `folderFor` does not error, it falls through to
 *   `inbox` — so the Drafts tab would quietly list the inbox.
 * - A draft has NO `receivedDateTime` and no meaningful `sentDateTime`. Without the
 *   `lastModifiedDateTime` fallback, `date` is `''`, which the client's
 *   `getItemTimestamp` turns into 0 — dragging the inbox watermark cutoff to the
 *   epoch and disabling the clamp that keeps merged sources in order.
 */
interface Internals {
  folderFor(labelIds?: string[]): string;
  mapEmailSummary(
    m: GraphMessage,
    completed: Set<string>,
    forwarded: Set<string>,
  ): EmailSummaryDto;
}

describe('Outlook drafts', () => {
  let svc: Internals;

  beforeEach(() => {
    svc = new MicrosoftService(
      {} as PrismaService,
      {} as MessageStateService,
    ) as unknown as Internals;
  });

  describe('folderFor', () => {
    it('maps the client folder id to the Graph well-known folder', () => {
      expect(svc.folderFor(['DRAFTS'])).toBe('drafts');
    });

    // The client sends Gmail's label spelling for one folder id; both are accepted so
    // the caller never has to know which provider it is talking to.
    it('accepts the singular Gmail spelling too', () => {
      expect(svc.folderFor(['DRAFT'])).toBe('drafts');
    });

    it('leaves the other folders alone', () => {
      expect(svc.folderFor(['SENT'])).toBe('sentItems');
      expect(svc.folderFor(['SPAM'])).toBe('junkEmail');
      expect(svc.folderFor(['TRASH'])).toBe('deletedItems');
      expect(svc.folderFor([])).toBe('inbox');
      expect(svc.folderFor(undefined)).toBe('inbox');
    });
  });

  describe('mapEmailSummary', () => {
    const draft = (over: Partial<GraphMessage> = {}): GraphMessage =>
      ({
        id: 'AAMk-draft',
        subject: 'half written',
        bodyPreview: 'hello there',
        isDraft: true,
        lastModifiedDateTime: '2026-09-09T10:00:00Z',
        toRecipients: [{ emailAddress: { address: 'client@example.com' } }],
        conversationId: 'conv-1',
        ...over,
      }) as GraphMessage;

    const empty = () => new Set<string>();

    it('dates a draft by lastModifiedDateTime', () => {
      const row = svc.mapEmailSummary(draft(), empty(), empty());
      expect(row.date).toBe('2026-09-09T10:00:00Z');
    });

    // The regression this exists to prevent: a 0 timestamp on the client.
    it('never leaves a draft with an empty date', () => {
      const row = svc.mapEmailSummary(draft(), empty(), empty());
      expect(row.date).not.toBe('');
      expect(Number.isNaN(new Date(row.date).getTime())).toBe(false);
    });

    it('carries the recipients, which is all that identifies a draft row', () => {
      const row = svc.mapEmailSummary(draft(), empty(), empty());
      expect(row.to).toBe('client@example.com');
    });

    /**
     * A Graph draft has no `internetMessageId`, so `stateKey` falls back to the
     * restId — and that identity changes the moment the draft is sent, orphaning any
     * row written under it. Both sets here contain the draft's id on purpose: a
     * mapper that consulted them would report `true`.
     */
    it('takes no part in read, completed or forwarded state', () => {
      const marked = new Set<string>(['AAMk-draft']);
      const row = svc.mapEmailSummary(draft({ isRead: false }), marked, marked);
      expect(row.isRead).toBe(true);
      expect(row.isCompleted).toBe(false);
      expect(row.isForwarded).toBe(false);
    });

    // A real message must be completely unaffected by any of the above.
    it('leaves a received message exactly as it was', () => {
      const received = {
        id: 'AAMk-real',
        subject: 'invoice',
        bodyPreview: 'please find',
        isRead: false,
        receivedDateTime: '2026-09-08T09:00:00Z',
        lastModifiedDateTime: '2026-09-09T12:00:00Z',
        internetMessageId: '<abc@example.com>',
        from: { emailAddress: { address: 'client@example.com' } },
      } as GraphMessage;

      const marked = new Set<string>(['<abc@example.com>']);
      const row = svc.mapEmailSummary(received, marked, marked);
      // receivedDateTime still wins over lastModifiedDateTime.
      expect(row.date).toBe('2026-09-08T09:00:00Z');
      expect(row.isRead).toBe(false);
      expect(row.isCompleted).toBe(true);
      expect(row.isForwarded).toBe(true);
    });
  });
});
