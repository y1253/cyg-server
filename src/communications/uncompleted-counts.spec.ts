import { CommunicationsController } from './communications.controller';
import type { GmailService } from '../gmail/gmail.service';
import type { MicrosoftService } from '../microsoft/microsoft.service';
import type { ProviderResolverService } from './provider-resolver.service';
import type { InternalMessagesService } from '../internal-messages/internal-messages.service';
import type { InternalCallsService } from '../internal-calls/internal-calls.service';
import type { PhoneTimelineService } from '../phone/phone-timeline.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The dashboard's cross-company badge.
 *
 * These are here because the bug this replaced was invisible in the code: the old
 * implementation spread three maps into one object literal, which reads as a merge and
 * is not one. A company present in two sources lost whichever count was spread first,
 * and a phone-only company had no key at all -- which `CompanyRow` renders as NO BADGE,
 * not as zero, so a backlog of calls and texts simply never appeared.
 */
describe('GET /communications/uncompleted-counts', () => {
  const USER_ID = 7;

  function build(opts: {
    gmail?: Record<number, number>;
    microsoft?: Record<number, number>;
    phone?: Record<number, number>;
    workspaceId?: number | null;
    internalCount?: number;
    internalCallCount?: number;
  }) {
    const controller = new CommunicationsController(
      {
        getUncompletedCounts: jest.fn().mockResolvedValue(opts.gmail ?? {}),
      } as unknown as GmailService,
      {
        getUncompletedCounts: jest.fn().mockResolvedValue(opts.microsoft ?? {}),
      } as unknown as MicrosoftService,
      {} as ProviderResolverService,
      {
        getUncompletedCount: jest
          .fn()
          .mockResolvedValue(opts.internalCount ?? 0),
      } as unknown as InternalMessagesService,
      {
        counts: jest
          .fn()
          .mockResolvedValue({ unread: 0, uncompleted: opts.internalCallCount ?? 0 }),
      } as unknown as InternalCallsService,
      {
        getUncompletedCountsForAll: jest
          .fn()
          .mockResolvedValue(opts.phone ?? {}),
      } as unknown as PhoneTimelineService,
      {
        company: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              opts.workspaceId == null ? null : { id: opts.workspaceId },
            ),
        },
      } as unknown as PrismaService,
    );
    return controller.uncompletedCounts({ user: { userId: USER_ID } });
  }

  it('gives a phone-only company a key, so the row draws a badge at all', async () => {
    // The whole point of the fix: company 3 has a support number and no mailbox.
    await expect(build({ gmail: {}, phone: { 3: 4 } })).resolves.toEqual({
      3: 4,
    });
  });

  it('SUMS a company that has both a mailbox and a phone', async () => {
    // Spreading would yield 4 here and silently drop the mail backlog.
    await expect(build({ gmail: { 3: 2 }, phone: { 3: 4 } })).resolves.toEqual({
      3: 6,
    });
  });

  it('sums across all three channel sources', async () => {
    await expect(
      build({ gmail: { 1: 1 }, microsoft: { 1: 2 }, phone: { 1: 3, 2: 5 } }),
    ).resolves.toEqual({ 1: 6, 2: 5 });
  });

  it('omits a company no source reported — absent means unknown, not zero', async () => {
    const map = await build({ gmail: { 1: 0 }, phone: {} });
    expect(map).toEqual({ 1: 0 });
    expect(2 in map).toBe(false);
  });

  it('SUMS the workspace messages and staff calls into one badge', async () => {
    // The workspace used to be an assignment, on the grounds that it "has no other
    // channel". Calls now share its inbox, so that is false -- and an assignment would
    // hide whichever of the two backlogs it overwrote.
    await expect(
      build({ workspaceId: 9, internalCount: 2, internalCallCount: 3 }),
    ).resolves.toEqual({ 9: 5 });
  });

  it('adds the workspace onto anything already keyed to that id', async () => {
    // Cannot happen today -- a workspace has no mailbox and no support number -- but the
    // controller is written to survive that stopping being true, so pin it.
    await expect(
      build({ phone: { 9: 3 }, workspaceId: 9, internalCount: 2 }),
    ).resolves.toEqual({ 9: 5 });
  });

  it('returns an empty map when nothing is connected anywhere', async () => {
    await expect(build({})).resolves.toEqual({});
  });
});
