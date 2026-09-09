/**
 * Bounded-concurrency map, shared by every path that fans out one upstream call
 * per item.
 *
 * Lives here rather than in `gmail/` or `microsoft/` because both providers need
 * it for the same reason, and `communications/` is the layer they share --
 * matching `attachment-name.util.ts` and the rest of this directory.
 *
 * ── WHY A POOL AND NOT `Promise.all` ──────────────────────────────────────────
 * Gmail bills `messages.get` at 5 quota units against a 250-units-per-user-per-
 * second cap. A 50-wide `Promise.all` is 255 units in one burst, so it 429s
 * essentially every time and googleapis backs off -- which is why a single page
 * of the inbox took seconds. The pool keeps the sustained rate under the cap
 * instead of discovering it by being throttled.
 *
 * Sustained rate is `concurrency / latency * unitsPerCall`. At ~150ms per
 * `messages.get`, a concurrency of 6 is ~200 units/s -- under the cap with
 * headroom. 8 and above goes back over it. See `GMAIL_GET_CONCURRENCY`.
 *
 * Results stay INDEX-ALIGNED with `items`, so a caller can zip them back
 * together positionally. `Promise.all` guarantees that too, and dropping it
 * here would silently corrupt every call site.
 */

/** Safe concurrency for Gmail `messages.get` (5 quota units each). */
export const GMAIL_GET_CONCURRENCY = 6;

export async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return out;
}
