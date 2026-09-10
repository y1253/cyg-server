import {
  chatToFeedItem,
  emailToFeedItem,
  internalCallToFeedItem,
  internalMessageToFeedItem,
  mergeUnreadFeed,
  phoneToFeedItem,
  sortableIso,
  type CompanyGroup,
} from './unread-feed.util';
import type { UnreadFeedItemDto } from './unread-feed.types';
import type { EmailSummaryDto } from './communications.types';
import type { CallItemDto, SmsItemDto } from '../phone/phone.types';

/**
 * The notification bell's feed.
 *
 * Every rule here fails SILENTLY when broken -- a row that should be in the list is
 * simply absent, with no error anywhere and nothing in a log to notice. That is the
 * whole reason these are pinned in a pure test rather than checked against a live
 * mailbox.
 */

const NOW = '2026-09-10T12:00:00.000Z';

function email(over: Partial<EmailSummaryDto> = {}): EmailSummaryDto {
  return {
    id: 'm1',
    threadId: 't1',
    subject: 'Invoice',
    from: 'Jane Doe <jane@x.com>',
    date: 'Thu, 10 Sep 2026 11:00:00 +0000',
    snippet: 'hello',
    isRead: false,
    isCompleted: false,
    isForwarded: false,
    attachments: [],
    ...over,
  };
}

function call(over: Partial<CallItemDto> = {}): CallItemDto {
  return {
    id: 'swcall:abc',
    sid: 'abc',
    kind: 'call',
    direction: 'inbound',
    counterparty: '+14385551212',
    supportNumber: '+14382561210',
    at: '2026-09-10T11:30:00.000Z',
    isRead: false,
    isCompleted: false,
    status: 'completed',
    outcome: 'missed',
    durationSec: 0,
    hasRecording: false,
    hasVoicemail: false,
    parentCallSid: null,
    ...over,
  };
}

/** Minimal item at a given time, for the ordering/capping rules. */
function at(time: string, companyId = 1, id = `x-${time}`): UnreadFeedItemDto {
  return {
    id,
    companyId,
    companyName: 'C',
    scope: 'company',
    kind: 'email',
    from: 'a',
    title: 't',
    snippet: '',
    at: time,
    msgId: id,
    threadId: null,
  };
}

describe('unread feed — per-company vs global cap', () => {
  it('a company with 200 unread cannot hide another company’s single unread', () => {
    const noisy: CompanyGroup = {
      companyId: 1,
      items: Array.from({ length: 200 }, (_, i) =>
        // All NEWER than the quiet company's one message.
        at(
          `2026-09-10T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
          1,
          `noisy-${i}`,
        ),
      ),
    };
    const quiet: CompanyGroup = {
      companyId: 2,
      items: [at('2026-09-09T09:00:00.000Z', 2, 'quiet-1')],
    };

    const { items, truncated } = mergeUnreadFeed([noisy, quiet]);

    expect(items.some((i) => i.id === 'quiet-1')).toBe(true);
    expect(items.filter((i) => i.companyId === 1)).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  it('truncated is the union of the per-company and global caps, not the last one', () => {
    // Eleven companies × 1 item = 11 rows: under the global cap, no company capped.
    const none = Array.from({ length: 11 }, (_, c) => ({
      companyId: c + 1,
      items: [at('2026-09-10T10:00:00.000Z', c + 1, `a-${c}`)],
    }));
    expect(mergeUnreadFeed(none).truncated).toBe(false);

    // One company over its own cap, total still under the global cap.
    const perCompanyOnly: CompanyGroup[] = [
      {
        companyId: 1,
        items: Array.from({ length: 12 }, (_, i) =>
          at('2026-09-10T10:00:00.000Z', 1, `b-${i}`),
        ),
      },
    ];
    const result = mergeUnreadFeed(perCompanyOnly);
    expect(result.items).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('orders newest first across companies', () => {
    const { items } = mergeUnreadFeed([
      { companyId: 1, items: [at('2026-09-01T00:00:00.000Z', 1, 'old')] },
      { companyId: 2, items: [at('2026-09-10T00:00:00.000Z', 2, 'new')] },
    ]);
    expect(items.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('same-millisecond items sort deterministically', () => {
    const t = '2026-09-10T10:00:00.000Z';
    const groups: CompanyGroup[] = [
      { companyId: 9, items: [at(t, 9, 'b')] },
      { companyId: 2, items: [at(t, 2, 'z')] },
      { companyId: 2, items: [at(t, 2, 'a')] },
    ];
    const first = mergeUnreadFeed(groups).items.map((i) => i.id);
    const again = mergeUnreadFeed([...groups].reverse()).items.map((i) => i.id);
    // Lower companyId first, then id — and stable whatever order the sweep returned.
    expect(first).toEqual(['a', 'z', 'b']);
    expect(again).toEqual(first);
  });
});

describe('unread feed — email mapping', () => {
  it('an email with an unparseable Date header is not silently dropped by the global cap', () => {
    const item = emailToFeedItem(1, 'Acme', email({ date: 'not a date' }), NOW);
    // A 0 here would sort it last and the global cap would eat it.
    expect(item.at).toBe(NOW);
    expect(Date.parse(item.at)).not.toBeNaN();
  });

  it('decodes a Gmail snippet’s entities rather than leaking them', () => {
    const item = emailToFeedItem(
      1,
      'Acme',
      email({ snippet: 'Bob&#39;s invoice &amp; receipt' }),
      NOW,
    );
    expect(item.snippet).toBe("Bob's invoice & receipt");
  });

  it('turns a quoted From header into a display name, not an address', () => {
    const item = emailToFeedItem(
      1,
      'Acme',
      email({ from: '"Doe, Jane" <jane@x.com>' }),
      NOW,
    );
    expect(item.from).toBe('Doe, Jane');
  });

  it('treats an empty threadId as absent', () => {
    const item = emailToFeedItem(1, 'Acme', email({ threadId: '' }), NOW);
    expect(item).toMatchObject({ kind: 'email', threadId: null });
  });
});

describe('unread feed — phone mapping', () => {
  it('a voicemail is kind "call" with isVoicemail — never a kind of its own', () => {
    const item = phoneToFeedItem(1, 'Acme', call({ hasVoicemail: true }), NOW);
    expect(item.kind).toBe('call');
    expect(item).toMatchObject({ isVoicemail: true, title: 'Voicemail' });
  });

  it('a call carries both sid and itemId, and itemId is the state key', () => {
    const item = phoneToFeedItem(1, 'Acme', call(), NOW);
    expect(item).toMatchObject({
      sid: 'abc',
      itemId: 'swcall:abc',
      id: 'swcall:abc',
    });
  });

  it('labels a missed call distinctly from an answered one', () => {
    expect(phoneToFeedItem(1, 'A', call(), NOW).title).toBe('Missed call');
    expect(
      phoneToFeedItem(1, 'A', call({ outcome: 'answered' }), NOW).title,
    ).toBe('Incoming call');
  });

  it('maps an SMS to its conversation peer', () => {
    const sms: SmsItemDto = {
      id: 'swsms:s1',
      sid: 's1',
      kind: 'sms',
      direction: 'inbound',
      counterparty: '+14385551212',
      supportNumber: '+14382561210',
      at: '2026-09-10T11:00:00.000Z',
      isRead: false,
      isCompleted: false,
      body: 'can you call me',
      numMedia: 0,
      status: 'received',
      errorCode: null,
    };
    expect(phoneToFeedItem(1, 'Acme', sms, NOW)).toMatchObject({
      kind: 'sms',
      peer: '+14385551212',
      msgId: 'swsms:s1',
      snippet: 'can you call me',
    });
  });
});

describe('unread feed — internal mapping', () => {
  it('namespaces internal ids so a numeric message id cannot collide with a call sid', () => {
    const msg = internalMessageToFeedItem(
      5,
      'Cyg Finance',
      {
        id: 12,
        threadId: 12,
        subject: 'Payroll',
        snippet: 'see attached',
        date: '2026-09-10T11:00:00.000Z',
        from: { name: 'Chaim' },
      },
      NOW,
    );
    const c = internalCallToFeedItem(
      5,
      'Cyg Finance',
      {
        id: 'intcall:12',
        sid: '12',
        at: '2026-09-10T11:00:00.000Z',
        outcome: 'missed',
        peer: { name: 'Chaim' },
      },
      NOW,
    );
    expect(msg.id).toBe('intmsg:12');
    expect(c.id).toBe('intcall:12');
    expect(msg.id).not.toBe(c.id);
  });
});

describe('sortableIso', () => {
  it('never returns epoch 0 for junk', () => {
    expect(sortableIso(undefined, NOW)).toBe(NOW);
    expect(sortableIso('', NOW)).toBe(NOW);
    expect(sortableIso('garbage', NOW)).toBe(NOW);
  });

  it('normalises an RFC 2822 timestamp, which is what SignalWire and Gmail send', () => {
    expect(sortableIso('Fri, 28 Aug 2026 16:54:13 +0000', NOW)).toBe(
      '2026-08-28T16:54:13.000Z',
    );
  });
});

describe('chat mapping', () => {
  it('keeps the raw provider time as the thread anchor', () => {
    const item = chatToFeedItem(
      1,
      'Acme',
      {
        id: 'spaces/A/messages/B',
        spaceId: 'spaces/A',
        spaceName: 'Acme team',
        spaceType: 'SPACE',
        sender: 'Jane',
        text: 'ping',
        createTime: '2026-09-10T11:00:00.123456Z',
        lastUpdateTime: '2026-09-10T11:00:00.123456Z',
        isRead: false,
        isCompleted: false,
        hasAttachments: false,
      },
      NOW,
    );
    expect(item).toMatchObject({
      kind: 'chat',
      spaceId: 'spaces/A',
      title: 'Acme team',
      // Anchor comparisons are against other provider times, so it must not be
      // rounded to the normalised sort value.
      msgTime: '2026-09-10T11:00:00.123456Z',
    });
  });
});
