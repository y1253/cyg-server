/**
 * Pure rules behind the notification-bell feed: how each channel's row becomes a feed
 * item, and how many companies' worth of them survive into one list.
 *
 * Pure and unit-tested for the usual reason in this directory — the capping and
 * ordering are fiddly, they are invisible when wrong (a row simply never appears), and
 * every one of them is cheaper to pin here than to reproduce against a live mailbox.
 */

import {
  FEED_CAP,
  PER_COMPANY_CAP,
  type UnreadFeedItemDto,
} from './unread-feed.types.js';
import { decodeHtmlEntities, fromDisplayName } from './preview.util.js';
import type {
  ChatListResult,
  EmailSummaryDto,
} from './communications.types.js';
import type { CallItemDto, PhoneItemDto } from '../phone/phone.types.js';

/** Long enough to recognise the message, short enough for a 26rem dropdown row. */
const SNIPPET_MAX = 140;

type ChatRow = ChatListResult['messages'][number];

/** What a company contributes before the global cap. */
export interface CompanyGroup {
  companyId: number;
  items: UnreadFeedItemDto[];
}

function clip(text: string, max = SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * A timestamp we can sort by, or the sweep time.
 *
 * NEVER falls back to 0. Epoch 0 sorts to the bottom of a newest-first list, where the
 * global cap then eats the row — so a single unparseable `Date` header would make a
 * genuinely unread email silently invisible. Treating it as "just now" is wrong by at
 * most the age of the message and keeps it reachable, which is the behaviour that
 * matters.
 */
export function sortableIso(
  raw: string | null | undefined,
  fallbackIso: string,
): string {
  if (!raw) return fallbackIso;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? fallbackIso : new Date(ms).toISOString();
}

export function emailToFeedItem(
  companyId: number,
  companyName: string,
  e: EmailSummaryDto,
  nowIso: string,
): UnreadFeedItemDto {
  return {
    id: e.id,
    companyId,
    companyName,
    scope: 'company',
    kind: 'email',
    // `getEmails` returns the raw RFC 5322 header and does NOT decode entities — only
    // `latestEmailPreview` did — so both passes belong here or `Bob&#39;s invoice`
    // leaks into the dropdown.
    from: fromDisplayName(e.from),
    title: e.subject,
    snippet: clip(decodeHtmlEntities(e.snippet ?? '')),
    at: sortableIso(e.date, nowIso),
    msgId: e.id,
    // An empty threadId is absence, not a thread called "". The client's Selection
    // takes `string | null` and opening a thread keys off null-ness.
    threadId: e.threadId || null,
  };
}

export function chatToFeedItem(
  companyId: number,
  companyName: string,
  m: ChatRow,
  nowIso: string,
): UnreadFeedItemDto {
  return {
    id: m.id,
    companyId,
    companyName,
    scope: 'company',
    kind: 'chat',
    from: m.sender,
    // A chat message has no subject; the space is the context worth showing.
    title: m.spaceName ?? '',
    snippet: clip(m.text ?? ''),
    at: sortableIso(m.createTime, nowIso),
    spaceId: m.spaceId,
    msgId: m.id,
    // The anchor ChatThreadView freezes at — the raw provider time, not the
    // normalised sort value, because it is compared against other message times.
    msgTime: m.createTime,
  };
}

/**
 * Who the row is from: the saved contact's name when there is one, else the number.
 *
 * `from` is documented as a DISPLAY sender — emails already arrive here through
 * `fromDisplayName` — so a phone row naming a saved contact is the same rule, not a new
 * one. Without it the bell would show a bare number for a caller the inbox two clicks
 * away is happy to name.
 *
 * `peer`/`sid`/`itemId` deliberately keep the raw number and sid: those are the values
 * that reopen the conversation, and a name cannot address anything.
 */
function displayPeer(i: PhoneItemDto): string {
  return i.counterpartyName || i.counterparty;
}

/** What a human would call this call, before any styling. */
function callTitle(c: CallItemDto): string {
  if (c.hasVoicemail) return 'Voicemail';
  if (c.outcome === 'missed') return 'Missed call';
  if (c.outcome === 'failed') return 'Failed call';
  return c.direction === 'inbound' ? 'Incoming call' : 'Outgoing call';
}

export function phoneToFeedItem(
  companyId: number,
  companyName: string,
  i: PhoneItemDto,
  nowIso: string,
): UnreadFeedItemDto {
  const at = sortableIso(i.at, nowIso);
  if (i.kind === 'sms') {
    return {
      id: i.id,
      companyId,
      companyName,
      scope: 'company',
      kind: 'sms',
      from: displayPeer(i),
      title: 'Text message',
      snippet: clip(i.body ?? ''),
      at,
      peer: i.counterparty,
      msgId: i.id,
      msgTime: i.at,
    };
  }
  return {
    id: i.id,
    companyId,
    companyName,
    scope: 'company',
    kind: 'call',
    from: displayPeer(i),
    title: callTitle(i),
    // A call has no text. The row's meaning is entirely in its title and time, and
    // inventing a snippet here would duplicate labelling the client already owns.
    snippet: '',
    at,
    sid: i.sid,
    itemId: i.id,
    isVoicemail: i.hasVoicemail,
  };
}

/** Only the fields the feed needs, so the mapper is not coupled to the whole row. */
export interface InternalMessageRow {
  id: number;
  threadId: number;
  subject: string;
  snippet: string;
  date: string;
  from: { name: string };
}

export function internalMessageToFeedItem(
  companyId: number,
  companyName: string,
  m: InternalMessageRow,
  nowIso: string,
): UnreadFeedItemDto {
  return {
    // Namespaced to match the client's `internalMessageItemId`, so a numeric message
    // id can never collide with a bare call sid in the one id space the panel keys on.
    id: `intmsg:${m.id}`,
    companyId,
    companyName,
    scope: 'internal',
    kind: 'message',
    from: m.from.name,
    title: m.subject,
    snippet: clip(m.snippet ?? ''),
    at: sortableIso(m.date, nowIso),
    messageId: m.id,
    threadId: m.threadId,
  };
}

export interface InternalCallRow {
  id: string;
  sid: string;
  at: string;
  outcome: 'answered' | 'missed' | 'in-progress';
  peer: { name: string };
}

export function internalCallToFeedItem(
  companyId: number,
  companyName: string,
  c: InternalCallRow,
  nowIso: string,
): UnreadFeedItemDto {
  return {
    // Already `intcall:{sid}` from the service; kept verbatim rather than re-minted.
    id: c.id,
    companyId,
    companyName,
    scope: 'internal',
    kind: 'call',
    from: c.peer.name,
    title: c.outcome === 'missed' ? 'Missed call' : 'Call',
    snippet: '',
    at: sortableIso(c.at, nowIso),
    sid: c.sid,
  };
}

/**
 * Newest first across every company, with the per-company cap applied FIRST.
 *
 * The order of the two caps is the rule worth protecting. Capping globally after a
 * single flat sort lets one busy mailbox own the entire feed: 200 unread emails from
 * one company push every other company's lone unread message past row 50, and the
 * person never learns it exists. Trimming each company first guarantees every company
 * that has anything unread is represented.
 *
 * The tie-break is `companyId` then `id`, so two items stamped in the same millisecond
 * order identically on every sweep — without it a row could swap places between polls
 * and read as movement that did not happen.
 */
export function mergeUnreadFeed(
  groups: CompanyGroup[],
  opts?: { perCompanyCap?: number; feedCap?: number },
): { items: UnreadFeedItemDto[]; truncated: boolean } {
  const perCompanyCap = opts?.perCompanyCap ?? PER_COMPANY_CAP;
  const feedCap = opts?.feedCap ?? FEED_CAP;

  let truncated = false;
  const flat: UnreadFeedItemDto[] = [];

  for (const group of groups) {
    const sorted = [...group.items].sort(compareFeedItems);
    if (sorted.length > perCompanyCap) truncated = true;
    flat.push(...sorted.slice(0, perCompanyCap));
  }

  flat.sort(compareFeedItems);
  if (flat.length > feedCap) truncated = true;

  // `truncated` is the UNION of both caps. Assigning it from the global check alone
  // would report a complete feed while a company's own rows had already been trimmed.
  return { items: flat.slice(0, feedCap), truncated };
}

function compareFeedItems(a: UnreadFeedItemDto, b: UnreadFeedItemDto): number {
  const byTime = Date.parse(b.at) - Date.parse(a.at);
  if (byTime !== 0) return byTime;
  if (a.companyId !== b.companyId) return a.companyId - b.companyId;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
