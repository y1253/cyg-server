import { UNCONNECTED } from '../phone/phone-timeline.util.js';

/** What actually happened on a staff-to-staff call. Mirrors `InternalCallView['outcome']`. */
export type InternalCallOutcome = 'answered' | 'missed' | 'in-progress';

/**
 * A staff call that needs no attention, because it already had it.
 *
 * ── THE RULE, AND ITS TWIN ────────────────────────────────────────────────────
 * This is the internal copy of `isImplicitlyReadCall` in
 * `phone/phone-timeline.util.ts`, which decides the same thing for a client company's
 * calls. One rule, two copies, each docblock naming the other — the convention
 * `isUnreadMissedCall` established. Changing one without the other makes a staff call and
 * a client call disagree about what "unread" means, in the same inbox.
 *
 * Before this, `isRead` was "outbound, or somebody clicked the dot": a colleague who rang
 * you, whom you ANSWERED and spoke to, still sat in your unread list and in the bell as if
 * it were work owed. A call you picked up has been read, by the only definition that means
 * anything.
 *
 * `missed` stays unread, and that is the entire point — the backlog is the colleague
 * nobody reached.
 *
 * ⚠️ `in-progress` also means "not yet backfilled" here (`outcomeOf` reads a null status
 * that way), so a call that has only just ended reads as read for the ring timeout and
 * then reappears the moment `backfillPending` writes `no-answer`. That is deliberate and
 * matches the company rule; treating it as UNREAD instead would flash every call as unread
 * the instant it is placed.
 *
 * ⚠️ An exhaustive switch with a `never` default, NOT `outcome !== 'missed'`. A fourth
 * outcome must break the build in BOTH copies; the tempting simplification would default
 * it to READ, which is how a colleague nobody reached stops appearing in the bell.
 */
export function isImplicitlyReadInternalCall(
  direction: 'inbound' | 'outbound',
  outcome: InternalCallOutcome,
): boolean {
  // You cannot have an unread call you placed.
  if (direction === 'outbound') return true;
  switch (outcome) {
    case 'answered':
    case 'in-progress':
      return true;
    case 'missed':
      return false;
    default: {
      const never: never = outcome;
      return never;
    }
  }
}

/**
 * The Prisma twin of the rule above, for the UNREAD folder and the unread count.
 *
 * A `where` clause cannot call `outcomeOf`, so the SQL has to say the same thing in the
 * columns it can see. `outcome === 'answered'` is exactly
 * `status != null AND status NOT IN (UNCONNECTED) AND durationSec > 0`.
 *
 * ⚠️ **`status: null` is deliberately NOT treated as read here, even though the function
 * above treats `in-progress` as read.** The two are not the same thing: to the function,
 * `in-progress` means a call that is genuinely live; in the COLUMN it also means "nobody
 * has asked SignalWire yet", which is every call for the first moments after it ends.
 *
 * Which way to err is decided by what happens next. A row this clause LISTS is handed to
 * `backfillPending` by `list()` itself, so it self-corrects on the very next refetch — an
 * answered call briefly showing in UNREAD is cosmetic and gone within one poll. A row this
 * clause HIDES is never backfilled through this folder at all, so a colleague nobody
 * reached would stay invisible until some other endpoint happened to ask. Erring toward
 * listing is the safe direction for a backlog.
 *
 * ⚠️ It must otherwise agree with `isImplicitlyReadInternalCall`, or the list, the folder
 * and the count chip disagree about the same call — the spec pins both against one table.
 */
export interface AnsweredWhere {
  AND: [{ status: { notIn: string[] } }, { durationSec: { gt: number } }];
}

// ⚠️ Spelled as a mutable tuple rather than `as const`: Prisma's `WhereInput` takes a
// mutable array, so a readonly one is a type error at every call site — and the tuple is
// what lets the spec compare the two halves field by field.
export const IMPLICITLY_READ_SQL: AnsweredWhere = {
  // Answered: a leg connected, and somebody was on it. `notIn` is false for NULL in SQL,
  // so a not-yet-backfilled row falls out here without needing a clause of its own.
  AND: [{ status: { notIn: [...UNCONNECTED] } }, { durationSec: { gt: 0 } }],
};
