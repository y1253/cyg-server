import {
  IMPLICITLY_READ_SQL,
  isImplicitlyReadInternalCall,
  type InternalCallOutcome,
} from './internal-call-read.util';
import { UNCONNECTED } from '../phone/phone-timeline.util';

describe('isImplicitlyReadInternalCall', () => {
  it('reads every call you placed, whatever came of it', () => {
    // You cannot have an unread call you placed — the same clause the company rule opens
    // with, and why only the callee columns exist on the row.
    for (const outcome of ['answered', 'missed', 'in-progress'] as const) {
      expect(isImplicitlyReadInternalCall('outbound', outcome)).toBe(true);
    }
  });

  it('reads an incoming call you answered', () => {
    // The bug this fixes: a colleague rang, you picked up and spoke, and it still sat in
    // your unread list and in the bell as if it were work owed.
    expect(isImplicitlyReadInternalCall('inbound', 'answered')).toBe(true);
  });

  it('reads a call that is still up', () => {
    expect(isImplicitlyReadInternalCall('inbound', 'in-progress')).toBe(true);
  });

  it('leaves a missed incoming call UNREAD', () => {
    // The whole point. The backlog is the colleague nobody reached.
    expect(isImplicitlyReadInternalCall('inbound', 'missed')).toBe(false);
  });
});

/**
 * The SQL half has to agree with the function half, or the list, the UNREAD folder and the
 * count chip disagree about the same call. Both are driven off ONE table of cases here.
 */
describe('IMPLICITLY_READ_SQL agrees with the function', () => {
  /** What `outcomeOf` in the service derives from the two columns. */
  const outcomeOf = (
    status: string | null,
    durationSec: number | null,
  ): InternalCallOutcome => {
    if (status === null) return 'in-progress';
    if (UNCONNECTED.has(status)) return 'missed';
    return (durationSec ?? 0) > 0 ? 'answered' : 'missed';
  };

  /** What MySQL makes of the clause. `notIn` is false for NULL, as in SQL. */
  const matchesSql = (status: string | null, durationSec: number | null) => {
    const [notIn, positive] = IMPLICITLY_READ_SQL.AND;
    const statusOk =
      status !== null && !notIn.status.notIn.includes(status);
    const durationOk = (durationSec ?? 0) > positive.durationSec.gt;
    return statusOk && durationOk;
  };

  const rows: [string | null, number | null][] = [
    ['completed', 55],
    ['completed', 0],
    ['no-answer', 18],
    ['busy', 0],
    ['canceled', 0],
    ['failed', 0],
    [null, null],
    [null, 0],
  ];

  it.each(rows)('status=%s duration=%s', (status, durationSec) => {
    const outcome = outcomeOf(status, durationSec);
    const byFunction = isImplicitlyReadInternalCall('inbound', outcome);

    if (status === null) {
      // ⚠️ The one deliberate disagreement, documented on the constant: a null status is
      // "nobody has asked SignalWire yet" as well as "live". The clause errs toward
      // LISTING, because a listed row is backfilled by `list()` and self-corrects, while a
      // hidden one is never backfilled through this folder at all.
      expect(byFunction).toBe(true);
      expect(matchesSql(status, durationSec)).toBe(false);
      return;
    }
    expect(matchesSql(status, durationSec)).toBe(byFunction);
  });

  it('counts an answered-but-zero-length call as missed, both ways', () => {
    // A `completed` root with no talk time is the ring-out the child-leg walk exists for.
    expect(isImplicitlyReadInternalCall('inbound', outcomeOf('completed', 0))).toBe(false);
    expect(matchesSql('completed', 0)).toBe(false);
  });
});
