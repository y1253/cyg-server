import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** Who an inbound call should ring, and what to show them. */
export interface CallRoute {
  companyId: number;
  companyName: string;
  /** Users whose browsers should display the call. Empty means nobody is available. */
  targetUserIds: number[];
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
        assignments: { select: { userId: true } },
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
