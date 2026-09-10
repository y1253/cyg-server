/**
 * The persistent unread feed behind the notification bell.
 *
 * One row per unread item across every company the caller is ASSIGNED to, plus their
 * own internal workspace — so staff can see what is waiting without first guessing
 * which company it landed in.
 *
 * Deliberately NOT in `communications.types.ts`: that file's contract is "both
 * provider services return these exact shapes", and this union spans phone and
 * internal messaging too, neither of which is a provider.
 */

/**
 * Rows taken from any one company before the global cap is applied.
 *
 * Applied FIRST, which is the whole point: one mailbox sitting on 200 unread emails
 * would otherwise fill a 50-row feed and hide every other company's single unread
 * message — the exact failure the bell exists to prevent.
 */
export const PER_COMPANY_CAP = 10;

/** Rows in the whole feed. Beyond this the badge reads "50+". */
export const FEED_CAP = 50;

interface FeedItemBase {
  /**
   * Stable row id, NOT namespaced by company.
   *
   * A provider message id is unique within the only mailbox that can produce it, and
   * rows are keyed `companyId|id` for rendering. The client's read-dismissal keys on
   * this alone, which is what lets `useMarkEmailRead` — which holds only a companyId
   * and a messageId — hide the row without knowing anything about the feed.
   */
  id: string;
  companyId: number;
  /**
   * Carried rather than looked up client-side: `useCompanies` has no refetchInterval,
   * so its cache can be cold or stale for a freshly assigned company.
   */
  companyName: string;
  /** Display sender — already through `fromDisplayName` / a peer's name. */
  from: string;
  /** Subject, or what stands in for one ('Voicemail', 'Missed call', 'Text message'). */
  title: string;
  /** Already entity-decoded and truncated. Plain text, never HTML. */
  snippet: string;
  /** ISO 8601. The single merge key across all six variants. */
  at: string;
}

/**
 * Discriminated on `(scope, kind)`.
 *
 * `scope` separates a client company's four channels from the internal workspace's
 * two, mirroring the client's deliberate split between `ItemKind`/`KIND_STYLES` and
 * `InternalItemKind`/`INTERNAL_KIND_STYLES` — two closed sets rather than one union
 * with members that can never occur for half its callers.
 *
 * Every variant carries exactly the fields needed to rebuild the client's `Selection`
 * so a click can open the item itself, not just the company.
 */
export type UnreadFeedItemDto =
  | (FeedItemBase & {
      scope: 'company';
      kind: 'email';
      msgId: string;
      threadId: string | null;
    })
  | (FeedItemBase & {
      scope: 'company';
      kind: 'chat';
      spaceId: string;
      msgId: string;
      /** The anchor the thread view freezes at. */
      msgTime: string;
    })
  | (FeedItemBase & {
      scope: 'company';
      kind: 'sms';
      /** The customer's E.164 number — what keys an SMS conversation. */
      peer: string;
      msgId: string;
      msgTime: string;
    })
  | (FeedItemBase & {
      scope: 'company';
      kind: 'call';
      /**
       * BOTH ids are carried, and they are not interchangeable: `itemId`
       * (`swcall:{sid}`) is the read-state key written to `ChatMessageReadState` /
       * `MessageCompletedState`, while `sid` is the bare SignalWire key. Conflating
       * them is the standing trap in this module.
       */
      sid: string;
      itemId: string;
      /** A voicemail is a FLAG on a call, never a kind — one event, one id. */
      isVoicemail: boolean;
    })
  | (FeedItemBase & {
      scope: 'internal';
      kind: 'message';
      messageId: number;
      threadId: number;
    })
  | (FeedItemBase & { scope: 'internal'; kind: 'call'; sid: string });

/** A company whose sweep threw. Reported, never silently counted as zero. */
export interface UnreadFeedFailure {
  companyId: number;
  companyName: string;
}

/** What `UnreadFeedService.forUser` returns — the unread half only. */
export interface UnreadFeedResult {
  items: UnreadFeedItemDto[];
  truncated: boolean;
  failed: UnreadFeedFailure[];
}

/**
 * The merged response of `GET /communications/inbox-summary`.
 *
 * ⚠️ ONE RESPONSE, TWO SCOPES — deliberate, not an oversight.
 *
 * `uncompleted` is GLOBAL (every company on the account) because the dashboard draws a
 * badge for every company it lists. `unread` is ASSIGNMENT-SCOPED because the bell must
 * only interrupt somebody about their own work.
 *
 * Anyone "making them consistent" would either leak other people's mail into the bell
 * or blank the dashboard's badges. `inbox-summary.spec.ts` pins it.
 */
export interface InboxSummaryDto {
  /** Unchanged from the route this replaced. Absent key ≠ 0 — absent means UNKNOWN. */
  uncompleted: Record<number, number>;
  /** The bell feed, newest first. The badge is `unread.length`. */
  unread: UnreadFeedItemDto[];
  /** A cap was hit somewhere, so the list is not the whole truth. */
  truncated: boolean;
  failed: UnreadFeedFailure[];
}
