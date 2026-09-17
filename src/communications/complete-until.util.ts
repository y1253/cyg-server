/**
 * "Mark everything in this conversation up to here as completed" — the pure part.
 *
 * Which messages that means is an ORDERING question, and ordering is exactly where this
 * goes wrong invisibly: the thread views disagree about direction (the SMS thread reads
 * oldest-first, a chat page arrives newest-first), so "take the first N" is right in one
 * and completes the wrong half of the conversation in the other. Sorting by time here
 * makes the caller's own order irrelevant.
 */

/** The minimum a message must expose to be placed in a conversation. */
export interface Placeable {
  id: string;
  /** ISO. */
  at: string;
}

/**
 * Compare two messages by when they happened, tie-broken on id.
 *
 * The tie-break is not decoration. WhatsApp timestamps arrive from Meta in whole SECONDS,
 * so several messages routinely share one `at`; without a stable second key the anchor's
 * own position among them is undefined, and "up to here" would include or exclude its
 * neighbours depending on how the sort happened to land.
 */
function byTime(a: Placeable, b: Placeable): number {
  const at = new Date(a.at).getTime() - new Date(b.at).getTime();
  if (at !== 0) return at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every id at or before `anchorId`, oldest first.
 *
 * ⚠️ Returns **null when the anchor is not in the list** — never "everything". The anchor
 * comes from a client whose thread view is capped (a chat page, 200 texts), so an anchor
 * that has scrolled out of the server's own rebuild is a real case, and the safe answer is
 * to refuse rather than to complete a whole conversation somebody never saw.
 *
 * An unparseable timestamp sorts as epoch 0, which puts it at the very start — it can be
 * swept up by a later anchor but can never drag a newer message in with it.
 */
export function idsUpTo<T extends Placeable>(
  items: readonly T[],
  anchorId: string,
): string[] | null {
  const ordered = [...items].sort(byTime);
  const index = ordered.findIndex((m) => m.id === anchorId);
  if (index === -1) return null;
  return ordered.slice(0, index + 1).map((m) => m.id);
}
