import type { TemplateStatus } from './whatsapp.util.js';

/**
 * Reconciling a stored template submission against what Meta now reports.
 *
 * Pure, so every rule below has a test that needs no Graph call — the split
 * `call-summary.util.ts` / `call-summary.service.ts` uses.
 */

/** A submission as we store it, reduced to what matching needs. */
export interface StoredSubmission {
  id: number;
  metaTemplateId: string | null;
  name: string;
  language: string;
  status: string;
  rejectedReason: string | null;
}

/** A template as `listTemplates` returns it, reduced to what matching needs. */
export interface LiveTemplate {
  id: string | null;
  name: string;
  language: string;
  status: TemplateStatus;
  rejectedReason: string | null;
}

/** What a reconcile decided for one row. `null` = nothing to write. */
export interface StatusPatch {
  id: number;
  status: string;
  rejectedReason: string | null;
}

/**
 * Find the live template a stored submission refers to.
 *
 * By Meta's id when we have one — it survives a rename — and otherwise by name+language,
 * which is the pair Meta itself keys on and refuses duplicates of.
 */
export function matchTemplate(
  row: StoredSubmission,
  live: readonly LiveTemplate[],
): LiveTemplate | null {
  if (row.metaTemplateId) {
    const byId = live.find((t) => t.id === row.metaTemplateId);
    if (byId) return byId;
  }
  return (
    live.find((t) => t.name === row.name && t.language === row.language) ?? null
  );
}

/**
 * What to write back after re-reading Meta's list, or `null` for "leave it alone".
 *
 * ── ⚠️ WHY THIS IS *NOT* A MONOTONIC LADDER LIKE `nextDeliveryStatus` ─────────
 * The obvious move is to copy the rank ladder that guards message delivery status. It
 * would be WRONG here, and the failure is silent.
 *
 * That ladder exists because Meta's *message* status webhooks arrive out of order and a
 * delivery genuinely only moves forward — `read` can never become `sent` again. A
 * template's status does not behave that way: `REJECTED -> PENDING -> APPROVED` is the
 * normal path after an edit, so a forward-only rule would pin a rejected template at
 * REJECTED for ever and the repair would appear to do nothing.
 *
 * There is no out-of-order problem to solve either: we do not receive template webhooks
 * at all (the app is subscribed to `messages` only), so this runs off a full re-read of
 * the list. Meta is the source of truth and the newest read wins.
 *
 * A row with no match is left untouched rather than guessed at — another company may hold
 * a template we cannot see, and `listTemplates` returns `[]` on any Graph failure, which
 * must never be read as "everything was deleted".
 */
export function reconcileSubmission(
  row: StoredSubmission,
  live: readonly LiveTemplate[],
): StatusPatch | null {
  const match = matchTemplate(row, live);
  if (!match) return null;
  const rejectedReason = match.rejectedReason ?? null;
  if (match.status === row.status && rejectedReason === row.rejectedReason) {
    return null;
  }
  return { id: row.id, status: match.status, rejectedReason };
}

/** Every row that needs a write. Empty when nothing moved — the usual case. */
export function reconcileSubmissions(
  rows: readonly StoredSubmission[],
  live: readonly LiveTemplate[],
): StatusPatch[] {
  return rows
    .map((row) => reconcileSubmission(row, live))
    .filter((patch): patch is StatusPatch => patch !== null);
}
