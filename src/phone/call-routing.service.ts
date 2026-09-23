import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isE164 } from './signalwire-parse.js';

/** Who an inbound call should ring, and what to show them. */
export interface CallRoute {
  companyId: number;
  companyName: string;
  /** Users whose browsers should display the call. Empty means nobody is available. */
  targetUserIds: number[];
  /**
   * The assigned users' own phones — the PSTN legs the ring group dials alongside the
   * browser, as conference participants (`RingGroupService`).
   *
   * Index-INDEPENDENT of `targetUserIds`: a user with no number on file contributes an id
   * and no phone. The two lists answer different questions (who is SHOWN the call vs. what
   * is DIALLED), so never zip them.
   *
   * `{ userId, e164 }` rather than a bare string because accepting the whisper has to name
   * the person on the company's busy indicator — `markAnswered` takes a user id.
   *
   * ⚠️ ALWAYS EMPTY on the admin-fallback path; see below.
   */
  targetPhones: { userId: number; e164: string }[];
  /** True when nobody is assigned and this fell back to the admins. */
  viaAdminFallback: boolean;
}

/**
 * Resolves an inbound call to the users who should see it.
 *
 * Deliberately separate from the LaML step and from the SSE push: this is the part
 * worth testing without a network, the same split as `signalwire-parse.ts` and
 * `laml.util.ts`. It also isolates the single change that per-user SIP credentials
 * would need — the ids it returns would become one `<Sip>` noun each, instead of the
 * one shared credential everything currently registers with.
 */
@Injectable()
export class CallRoutingService {
  private readonly logger = new Logger(CallRoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `To` (the dialled support number, E.164) → company → who rings.
   *
   * Returns null when the number belongs to no active company, which the caller turns
   * into a holding message rather than connecting the caller to silence.
   */
  async resolve(to: string): Promise<CallRoute | null> {
    const number = await this.findActiveNumber(to);
    if (!number) {
      this.logger.warn(`inbound call to ${to} matches no active SupportNumber`);
      return null;
    }

    const company = await this.prisma.company.findFirst({
      where: { id: number.companyId, deletedAt: null },
      select: {
        id: true,
        businessName: true,
        // The assignee's own mobile, taken from the assignment row we are already reading —
        // no second query. This class's docblock predicted that per-user SIP credentials
        // would be "the single change" it needed; per-user PSTN legs turned out to be the
        // same change, in the same place.
        assignments: {
          select: {
            userId: true,
            user: { select: { phoneE164: true, deletedAt: true } },
          },
        },
      },
    });
    if (!company) {
      this.logger.warn(
        `SupportNumber ${to} points at company ${number.companyId}, which is missing or deleted`,
      );
      return null;
    }

    // `assignUser()` deletes every row for the company before creating one, so this is
    // at most a single user — `assignments[0]` is the codebase's canonical expression
    // for "the assigned user".
    const assigned = company.assignments.map((a) => a.userId);
    if (assigned.length > 0) {
      return {
        companyId: company.id,
        companyName: company.businessName,
        targetUserIds: assigned,
        // `deletedAt` IS filtered here and deliberately is NOT on `targetUserIds` above:
        // pushing an SSE event at a soft-deleted user's id is inert, whereas DIALLING their
        // mobile rings a person who no longer works here. `isE164` because the column is
        // only as good as the last write to it, and a malformed value handed to
        // `createCall` fails as a leg that never connects — silently, mid-ring.
        targetPhones: company.assignments.flatMap((a) => {
          const e164 = a.user?.phoneE164;
          const live = a.user?.deletedAt === null;
          return live && e164 && isE164(e164)
            ? [{ userId: a.userId, e164 }]
            : [];
        }),
        viaAdminFallback: false,
      };
    }

    // Nobody assigned. Ring the admins rather than dropping a client's call silently.
    //
    // Deliberately ADMIN only, not MANAGEMENT_ROLES: a manager is an admin almost
    // everywhere else, but this is the one place the role decides whose phone rings.
    // Widening it would ring the whole management tier on every unrouted call. Assign
    // the company to the manager instead -- that is what the assignment is for.
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN, deletedAt: null },
      select: { id: true },
    });
    this.logger.log(
      `${company.businessName} has no assigned user — falling back to ${admins.length} admin(s)`,
    );
    return {
      companyId: company.id,
      companyName: company.businessName,
      targetUserIds: admins.map((a) => a.id),
      // ⚠️ DELIBERATELY EMPTY, and this is the whole rule.
      //
      // The admin fallback means "nobody owns this company, so put it in front of everyone
      // who could pick it up" -- a screen an admin may glance at. Ringing every admin's
      // PERSONAL phone, for every unassigned company, is a different proposition entirely,
      // and the remedy is the one this fallback already documents: assign the company.
      //
      // It also costs nothing to hold this line: no widening of the `user.findMany` above,
      // no phones fetched, no decision to revisit.
      targetPhones: [],
      viaAdminFallback: true,
    };
  }

  /**
   * The dialled number → its active `SupportNumber` row.
   *
   * `phoneNumber` is NOT unique on that table: carriers resell numbers, so a released
   * row can carry the same value as a live one. Filtering on `releasedAt: null` and
   * taking the newest is what makes this correct — mirrors `getActiveNumber()`. The
   * index `idx_support_number_phone` already exists for this lookup.
   *
   * Deliberately NOT `Company.supportNumber`: that column is an admin-editable mirror
   * whose write is allowed to fail silently, while `SupportNumber` is the authority.
   */
  private findActiveNumber(phoneNumber: string) {
    return this.prisma.supportNumber.findFirst({
      where: { phoneNumber, releasedAt: null },
      orderBy: { id: 'desc' },
      select: { companyId: true },
    });
  }
}
