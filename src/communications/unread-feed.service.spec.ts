import { UnreadFeedService } from './unread-feed.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { GmailService } from '../gmail/gmail.service';
import type { MicrosoftService } from '../microsoft/microsoft.service';
import type { InternalMessagesService } from '../internal-messages/internal-messages.service';
import type { InternalCallsService } from '../internal-calls/internal-calls.service';
import type { PhoneTimelineService } from '../phone/phone-timeline.service';

/**
 * The bell feed's scoping and failure rules.
 *
 * Both are things that fail QUIETLY: the wrong scope shows somebody another person's
 * mail (or nothing at all), and a swallowed error reports a clean inbox that isn't one.
 * Neither produces an error anywhere, so neither would be noticed in use.
 */
describe('UnreadFeedService', () => {
  const USER_ID = 7;

  interface Company {
    id: number;
    businessName: string;
    isInternal: boolean;
  }

  function build(opts: {
    /** What the assignment query returns — i.e. already scoped. */
    companies?: Company[];
    googleIds?: number[];
    emails?: jest.Mock;
    chats?: jest.Mock;
    phone?: jest.Mock;
    internalMessages?: unknown[];
    internalCalls?: unknown[];
  }) {
    const companies = opts.companies ?? [];
    const findMany = jest.fn<Promise<Company[]>, [{ where: unknown }]>(() =>
      Promise.resolve(companies),
    );
    const prisma = {
      company: { findMany },
      gmailAccount: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            (
              opts.googleIds ??
              companies.filter((c) => !c.isInternal).map((c) => c.id)
            ).map((companyId) => ({ companyId })),
          ),
      },
      microsoftAccount: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const getEmails =
      opts.emails ??
      jest.fn().mockResolvedValue({ messages: [], nextPageToken: null });
    const getChats =
      opts.chats ??
      jest.fn().mockResolvedValue({ messages: [], needsReconnect: false });
    const gmail = { getEmails, getChats } as unknown as GmailService;

    const getUnreadItems = opts.phone ?? jest.fn().mockResolvedValue([]);

    const service = new UnreadFeedService(
      prisma,
      gmail,
      { getEmails, getChats } as unknown as MicrosoftService,
      {
        list: jest.fn().mockResolvedValue({
          messages: opts.internalMessages ?? [],
          nextCursor: null,
        }),
      } as unknown as InternalMessagesService,
      {
        list: jest.fn().mockResolvedValue({
          calls: opts.internalCalls ?? [],
          nextCursor: null,
        }),
      } as unknown as InternalCallsService,
      { getUnreadItems } as unknown as PhoneTimelineService,
    );
    return { service, findMany, getEmails, getChats, getUnreadItems };
  }

  const unreadEmail = {
    id: 'm1',
    threadId: 't1',
    subject: 'Invoice',
    from: 'Jane <jane@x.com>',
    date: 'Thu, 10 Sep 2026 11:00:00 +0000',
    snippet: 'hello',
    isRead: false,
    isCompleted: false,
    isForwarded: false,
    attachments: [],
  };

  it('scopes to assignment — an unassigned admin gets nothing', async () => {
    // The query IS the rule (listOwnCompanies), so the assertion is that nothing else
    // widens it: no company list, no rows, and not one provider call.
    const { service, findMany, getEmails } = build({ companies: [] });

    await expect(service.forUser(USER_ID)).resolves.toEqual({
      items: [],
      truncated: false,
      failed: [],
    });
    expect(getEmails).not.toHaveBeenCalled();
    // Assert the real argument rather than a nested matcher, so the scoping clause is
    // pinned exactly and not merely "contains something shaped like it".
    const [[args]] = findMany.mock.calls;
    expect(args.where).toEqual({
      deletedAt: null,
      OR: [
        { internalOwnerId: USER_ID },
        { assignments: { some: { userId: USER_ID } } },
      ],
    });
  });

  it('reports a company whose mailbox throws in `failed`, never as zero items', async () => {
    const { service } = build({
      companies: [{ id: 3, businessName: 'Acme', isInternal: false }],
      emails: jest.fn().mockRejectedValue(new Error('invalid_grant')),
    });

    const res = await service.forUser(USER_ID);
    expect(res.failed).toEqual([{ companyId: 3, companyName: 'Acme' }]);
    expect(res.items).toEqual([]);
  });

  it('treats needsReconnect as a failure, not an empty mailbox', async () => {
    const { service } = build({
      companies: [{ id: 3, businessName: 'Acme', isInternal: false }],
      emails: jest.fn().mockResolvedValue({
        messages: [],
        nextPageToken: null,
        needsReconnect: true,
      }),
    });
    expect((await service.forUser(USER_ID)).failed).toHaveLength(1);
  });

  it('keeps a company’s other channels when only one of them fails', async () => {
    // A revoked mailbox must not take the company's calls and texts down with it.
    const { service } = build({
      companies: [{ id: 3, businessName: 'Acme', isInternal: false }],
      emails: jest.fn().mockRejectedValue(new Error('boom')),
      phone: jest.fn().mockResolvedValue([
        {
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
          hasVoicemail: true,
          parentCallSid: null,
        },
      ]),
    });

    const res = await service.forUser(USER_ID);
    expect(res.failed).toHaveLength(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ kind: 'call', isVoicemail: true });
  });

  it('asks the internal services for the CALLER’s unread only', async () => {
    const { service } = build({
      companies: [{ id: 9, businessName: 'Cyg Finance', isInternal: true }],
      googleIds: [],
      internalMessages: [
        {
          id: 12,
          threadId: 12,
          subject: 'Payroll',
          snippet: 'see attached',
          date: '2026-09-10T11:00:00.000Z',
          from: { name: 'Chaim' },
        },
      ],
    });

    const res = await service.forUser(USER_ID);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      scope: 'internal',
      kind: 'message',
      id: 'intmsg:12',
      companyId: 9,
    });
  });

  it('does not ask a provider about an internal workspace', async () => {
    // A workspace has no mailbox; asking would be a guaranteed error per sweep.
    const { service, getEmails, getUnreadItems } = build({
      companies: [{ id: 9, businessName: 'Cyg Finance', isInternal: true }],
      googleIds: [],
    });
    await service.forUser(USER_ID);
    expect(getEmails).not.toHaveBeenCalled();
    expect(getUnreadItems).not.toHaveBeenCalled();
  });

  it('two callers inside one TTL cause ONE sweep per company', async () => {
    // N signed-in tabs polling every 60s must not each pay the fan-out.
    const { service, getEmails } = build({
      companies: [{ id: 3, businessName: 'Acme', isInternal: false }],
      emails: jest
        .fn()
        .mockResolvedValue({ messages: [unreadEmail], nextPageToken: null }),
    });

    const [a, b] = await Promise.all([
      service.forUser(USER_ID),
      service.forUser(USER_ID),
    ]);
    await service.forUser(USER_ID); // and again, now off the cache

    expect(getEmails).toHaveBeenCalledTimes(1);
    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);
  });

  it('filters out a row the provider reported as already read', async () => {
    // Defensive: the UNREAD label query should not return these, but the provider's own
    // unread cache can be a beat stale and a read row in the bell is the visible bug.
    const { service } = build({
      companies: [{ id: 3, businessName: 'Acme', isInternal: false }],
      emails: jest.fn().mockResolvedValue({
        messages: [unreadEmail, { ...unreadEmail, id: 'm2', isRead: true }],
        nextPageToken: null,
      }),
    });
    const res = await service.forUser(USER_ID);
    expect(res.items.map((i) => i.id)).toEqual(['m1']);
  });
});
