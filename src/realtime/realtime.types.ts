/**
 * The vocabulary of the real-time channel.
 *
 * ── WHY A TOPIC AND NOT A PAYLOAD ──────────────────────────────────────────────
 * Every event here is an INVALIDATION SIGNAL, not data. The client's answer to one is
 * `queryClient.invalidateQueries`, which re-reads through the ordinary authorised route
 * — so the channel can never hand anybody a row they could not already fetch, and the
 * routes stay the single place authorisation is decided.
 *
 * `ringing` is the one exception and carries a `CallEvent`, because the softphone needs
 * the event itself to pair an INVITE rather than a hint to refetch. It is delivered to
 * exactly the audience `PhoneEventsService.broadcastIncomingCall` already computes.
 */
export type RealtimeTopic =
  /** A call reached a terminal status. Timeline, counts, badges, bell. */
  | 'call-ended'
  /** A call progressed without ending, or a call was placed. Timeline only. */
  | 'phone'
  /** Read/completed state was written for a phone item. */
  | 'phone-state'
  /** The company's line became busy or free. */
  | 'active-call'
  /** A call is ringing. Carries a `CallEvent` payload. */
  | 'ringing'
  /** An inbound text arrived. */
  | 'sms'
  /** An inbound WhatsApp message arrived, or a delivery status moved. */
  | 'whatsapp'
  /** New mail, or mailbox read/completed state changed. */
  | 'email'
  /** A staff-to-staff message was sent. */
  | 'internal-message'
  /** A staff-to-staff call started or settled. */
  | 'internal-call'
  /** The set of online/busy colleagues changed. */
  | 'presence';

export interface RealtimeEvent {
  /** Monotonic within one server process. The client's resume cursor. */
  seq: number;
  /** Epoch ms, for the buffer sweep and for debugging a late delivery. */
  at: number;
  topic: RealtimeTopic;
  /**
   * Which company this concerns, when it concerns one.
   *
   * Broadcast to every authenticated user. That discloses nothing new: `uncompleted` and
   * `missedCalls` on `GET /communications/inbox-summary` are documented GLOBAL and the
   * dashboard already badges every company for everybody. Narrow with `userIds` for
   * anything that is genuinely per-user.
   */
  companyId?: number;
  /** When present, only these users receive the event. */
  userIds?: number[];
  /** `ringing` only. See the note on `RealtimeTopic`. */
  payload?: unknown;
}

/** What `publish` accepts. `seq` and `at` are the service's to assign. */
export interface RealtimePublishOptions {
  companyId?: number;
  userIds?: number[];
  payload?: unknown;
}

export interface RealtimeBatch {
  /** The cursor to send back as `since` on the next request. */
  seq: number;
  events: RealtimeEvent[];
  /**
   * The caller's cursor could not be served from the buffer, so events were missed.
   *
   * The client answers with ONE broad invalidation rather than replaying a backlog it
   * cannot see. Absent on the happy path, and on a brand-new client (`since=0`), which
   * has nothing stale to invalidate — its queries were fetched moments ago.
   */
  reset?: boolean;
}
