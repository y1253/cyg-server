import { google } from 'googleapis';
import { GmailService } from './gmail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessageStateService } from '../communications/message-state.service';

/**
 * Caching message BODIES without ever caching message STATE.
 *
 * One page of the inbox used to be 1 `messages.list` + 50
 * `messages.get(format:'full')` -- 255 Gmail quota units in a single burst
 * against a 250-per-second cap, so it throttled and the page took seconds.
 *
 * The fix caches the immutable half of a row for hours. That is only safe
 * because the volatile half -- `isRead`, `isCompleted`, `isForwarded` -- is
 * re-derived on EVERY request from separately-busted sources. If a body cache
 * ever starts carrying state, a user ticks a message off and watches it come
 * back, which is the failure this file exists to prevent.
 */
describe('getEmails — body cache vs. state', () => {
  const COMPANY = 42;

  let svc: GmailService;
  let messagesList: jest.Mock;
  let messagesGet: jest.Mock;
  let messagesModify: jest.Mock;
  let completed: Set<string>;
  let forwarded: Set<string>;

  /** Ids Gmail reports as unread, in the order the walk will see them. */
  let unreadOnServer: string[];

  const message = (id: string) => ({
    data: {
      threadId: `t-${id}`,
      snippet: `snippet ${id}`,
      payload: {
        headers: [
          { name: 'Subject', value: `subject ${id}` },
          { name: 'From', value: 'someone@example.com' },
          { name: 'Date', value: 'Mon, 1 Sep 2026 10:00:00 +0000' },
        ],
      },
    },
  });

  beforeEach(() => {
    completed = new Set<string>();
    forwarded = new Set<string>();
    unreadOnServer = [];

    messagesGet = jest.fn((args: { id: string }) =>
      Promise.resolve(message(args.id)),
    );
    messagesModify = jest.fn().mockResolvedValue({});
    messagesList = jest.fn((args: { labelIds?: string[] }) => {
      // The unread-set walk asks for the UNREAD label on its own.
      if (args.labelIds?.length === 1 && args.labelIds[0] === 'UNREAD')
        return Promise.resolve({
          data: { messages: unreadOnServer.map((id) => ({ id })) },
        });
      return Promise.resolve({
        data: { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: null },
      });
    });

    jest.spyOn(google, 'gmail').mockReturnValue({
      users: {
        messages: {
          list: messagesList,
          get: messagesGet,
          modify: messagesModify,
        },
      },
    } as unknown as ReturnType<typeof google.gmail>);

    svc = new GmailService({} as PrismaService, {
      getCompletedSet: () => Promise.resolve(completed),
      getForwardedSet: () => Promise.resolve(forwarded),
    } as unknown as MessageStateService);

    (
      svc as unknown as { ensureFreshTokens: () => Promise<unknown> }
    ).ensureFreshTokens = jest.fn().mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  const bodyFetches = () => messagesGet.mock.calls.length;

  it('fetches each body once, then serves it from cache', async () => {
    await svc.getEmails(COMPANY);
    expect(bodyFetches()).toBe(2);

    await svc.getEmails(COMPANY);
    expect(bodyFetches()).toBe(2); // second page cost zero body fetches
  });

  it('still reflects a completion change with no body refetch', async () => {
    const first = await svc.getEmails(COMPANY);
    expect(first.messages.map((m) => m.isCompleted)).toEqual([false, false]);

    completed.add('a');

    const second = await svc.getEmails(COMPANY);
    expect(second.messages.map((m) => m.isCompleted)).toEqual([true, false]);
    // The point: fresh state, and not one extra body fetch to get it.
    expect(bodyFetches()).toBe(2);
  });

  it('still reflects a forwarded change with no body refetch', async () => {
    await svc.getEmails(COMPANY);
    forwarded.add('b');

    const second = await svc.getEmails(COMPANY);
    expect(second.messages.map((m) => m.isForwarded)).toEqual([false, true]);
    expect(bodyFetches()).toBe(2);
  });

  it('derives isRead from the unread set, not from a cached body', async () => {
    unreadOnServer = ['a'];
    const first = await svc.getEmails(COMPANY);
    expect(first.messages.map((m) => m.isRead)).toEqual([false, true]);

    // Someone reads 'a' elsewhere. Bust is what makes this visible, not a TTL.
    unreadOnServer = [];
    svc.bustUnread(COMPANY);

    const second = await svc.getEmails(COMPANY);
    expect(second.messages.map((m) => m.isRead)).toEqual([true, true]);
    expect(bodyFetches()).toBe(2);
  });

  it('marking read busts the unread set immediately', async () => {
    unreadOnServer = ['a'];
    await svc.getEmails(COMPANY);

    unreadOnServer = [];
    await svc.markAsRead(COMPANY, 'a');

    // No TTL wait: the very next read must show it as read.
    const after = await svc.getEmails(COMPANY);
    expect(after.messages.find((m) => m.id === 'a')!.isRead).toBe(true);
  });

  it('marking unread busts the unread set immediately', async () => {
    unreadOnServer = [];
    await svc.getEmails(COMPANY);

    unreadOnServer = ['a'];
    await svc.markAsUnread(COMPANY, 'a');

    const after = await svc.getEmails(COMPANY);
    expect(after.messages.find((m) => m.id === 'a')!.isRead).toBe(false);
  });

  it('never stores state on the cached body record', async () => {
    completed.add('a');
    unreadOnServer = ['a'];
    await svc.getEmails(COMPANY);

    const cache = (
      svc as unknown as {
        messageCache: Map<string, { rec: Record<string, unknown> }>;
      }
    ).messageCache;

    for (const [, entry] of cache) {
      expect(entry.rec).not.toHaveProperty('isRead');
      expect(entry.rec).not.toHaveProperty('isCompleted');
      expect(entry.rec).not.toHaveProperty('isForwarded');
    }
  });

  it('asks for the whole unread set once, not once per message', async () => {
    await svc.getEmails(COMPANY);
    const unreadCalls = messagesList.mock.calls.filter(
      (c: [{ labelIds?: string[] }]) =>
        c[0].labelIds?.length === 1 && c[0].labelIds[0] === 'UNREAD',
    );
    expect(unreadCalls).toHaveLength(1);
  });

  it('scopes the unread walk to UNREAD alone, so Spam and Trash still show it', async () => {
    await svc.getEmails(COMPANY);
    const unreadCall = messagesList.mock.calls.find(
      (c: [{ labelIds?: string[] }]) => c[0].labelIds?.includes('UNREAD'),
    );
    // `INBOX,UNREAD` would report every unread spam message as read.
    expect(unreadCall![0].labelIds).toEqual(['UNREAD']);
  });

  it('takes a smaller first page and a full page thereafter', async () => {
    await svc.getEmails(COMPANY);
    expect(messagesList.mock.calls[0][0].maxResults).toBe(25);

    messagesList.mockClear();
    await svc.getEmails(COMPANY, 'page-2');
    expect(messagesList.mock.calls[0][0].maxResults).toBe(50);
  });
});
