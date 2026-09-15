/**
 * One-off: re-derive the outcome of internal staff-to-staff calls already in the database.
 *
 *   cd server
 *   node --env-file=.env scripts/backfill-internal-call-outcomes.mjs           # report only
 *   node --env-file=.env scripts/backfill-internal-call-outcomes.mjs --apply   # write
 *   node --env-file=.env scripts/backfill-internal-call-outcomes.mjs --limit=50
 *
 * ── WHY A SCRIPT AND NOT JUST THE FIX ─────────────────────────────────────────
 * `InternalCall.status` used to be filled from the ROOT leg, which is an `outbound-api`
 * leg whose `<Dial>` completes whether or not anybody picks up — and whose duration is the
 * RING time, not talk time. So every unanswered staff call was stored as
 * `completed` with a non-zero duration and rendered "Answered". Verified live:
 *
 *   ROOT  d73f72ce  outbound-api   completed  dur=19
 *   child 102a14fe  outbound-dial  no-answer  dur=18
 *   child eb256517  outbound-dial  no-answer  dur=18
 *
 * `backfillPending` now reads the child legs instead — but it only ever touches rows whose
 * `status` is still NULL, so every row already written keeps its wrong answer forever.
 * This is the thing that repairs them.
 *
 * ⚠️ Costs ONE SignalWire request per row examined. Run it once, by hand, not on a timer.
 *
 * Safe to re-run: it recomputes from SignalWire each time and only writes rows whose stored
 * status disagrees. A call whose legs SignalWire no longer has is left exactly as it is —
 * guessing would be worse than an old row that is already wrong.
 */
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 500;

const { SIGNALWIRE_PROJECT_ID: project, SIGNALWIRE_API_TOKEN: token } = process.env;
const space = process.env.SIGNALWIRE_SPACE_URL;

if (!project || !token || !space) {
  console.error(
    'SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN and SIGNALWIRE_SPACE_URL must be set.',
  );
  process.exit(1);
}

/** Statuses that mean the two people never spoke. Mirrors UNCONNECTED in the timeline. */
const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);

const auth = 'Basic ' + Buffer.from(`${project}:${token}`).toString('base64');
const base = `https://${space}/api/laml/2010-04-01/Accounts/${project}`;

async function get(path) {
  const res = await fetch(base + path, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * The leg that decided the outcome.
 *
 * Mirrors `pickConnectedChild`: a leg that CONNECTED beats one that did not, whatever the
 * clock says — an unanswered branch carries its ring time, which is exactly how the
 * duration-only rule picked the wrong leg.
 */
function decidingLeg(children) {
  let best = null;
  for (const leg of children) {
    if (!best) {
      best = leg;
      continue;
    }
    const legOk = !UNCONNECTED.has(leg.status);
    const bestOk = !UNCONNECTED.has(best.status);
    if (legOk !== bestOk) {
      if (legOk) best = leg;
      continue;
    }
    if (Number(leg.duration) > Number(best.duration)) best = leg;
  }
  return best;
}

const prisma = new PrismaClient();

try {
  const rows = await prisma.internalCall.findMany({
    where: { status: { not: null } },
    select: { id: true, callSid: true, status: true, durationSec: true },
    orderBy: { id: 'desc' },
    take: limit,
  });

  console.log(
    `${rows.length} internal call(s) with a stored status` +
      (apply ? '' : ' — REPORT ONLY, pass --apply to write') +
      '\n',
  );

  let changed = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const row of rows) {
    let root;
    let children;
    try {
      [root, children] = await Promise.all([
        get(`/Calls/${row.callSid}.json`),
        get(`/Calls.json?ParentCallSid=${encodeURIComponent(row.callSid)}&PageSize=20`)
          .then((d) => d.calls ?? [])
          // An ignored ParentCallSid returns EVERYTHING rather than erroring, so the
          // in-memory re-filter is what stops another call's answered leg landing here.
          .then((legs) => legs.filter((l) => l.parent_call_sid === row.callSid)),
      ]);
    } catch (err) {
      skipped++;
      console.log(`  ${row.callSid}  SKIP  ${String(err).slice(0, 80)}`);
      continue;
    }

    const leg = decidingLeg(children);
    // No leg means nobody was ever reached — an answered internal call is a <Dial><Sip>
    // and always produces one. Falling back to the root's `completed` here would be the
    // very bug this script exists to repair. Mirrors `backfillPending`.
    const status = leg ? leg.status : root.status;
    const durationSec = leg ? Number(leg.duration) || 0 : 0;

    const wasMissed = UNCONNECTED.has(row.status) || (row.durationSec ?? 0) === 0;
    const nowMissed = UNCONNECTED.has(status) || durationSec === 0;

    if (status === row.status && durationSec === (row.durationSec ?? 0)) {
      unchanged++;
      continue;
    }

    changed++;
    console.log(
      `  ${row.callSid}  ${row.status}/${row.durationSec ?? 0}s -> ${status}/${durationSec}s` +
        (wasMissed !== nowMissed
          ? `   ** ${wasMissed ? 'missed' : 'answered'} -> ${nowMissed ? 'MISSED' : 'ANSWERED'} **`
          : ''),
    );

    if (apply) {
      await prisma.internalCall.update({
        where: { id: row.id },
        data: { status, durationSec },
      });
    }
  }

  console.log(
    `\n${changed} would change, ${unchanged} already correct, ${skipped} skipped.` +
      (apply ? ' Written.' : ' Nothing written — re-run with --apply.'),
  );
} finally {
  await prisma.$disconnect();
}
