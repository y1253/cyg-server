"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortableIso = sortableIso;
exports.emailToFeedItem = emailToFeedItem;
exports.chatToFeedItem = chatToFeedItem;
exports.phoneToFeedItem = phoneToFeedItem;
exports.internalMessageToFeedItem = internalMessageToFeedItem;
exports.internalCallToFeedItem = internalCallToFeedItem;
exports.mergeUnreadFeed = mergeUnreadFeed;
const unread_feed_types_js_1 = require("./unread-feed.types.js");
const preview_util_js_1 = require("./preview.util.js");
const SNIPPET_MAX = 140;
function clip(text, max = SNIPPET_MAX) {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
function sortableIso(raw, fallbackIso) {
    if (!raw)
        return fallbackIso;
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? fallbackIso : new Date(ms).toISOString();
}
function emailToFeedItem(companyId, companyName, e, nowIso) {
    return {
        id: e.id,
        companyId,
        companyName,
        scope: 'company',
        kind: 'email',
        from: (0, preview_util_js_1.fromDisplayName)(e.from),
        title: e.subject,
        snippet: clip((0, preview_util_js_1.decodeHtmlEntities)(e.snippet ?? '')),
        at: sortableIso(e.date, nowIso),
        msgId: e.id,
        threadId: e.threadId || null,
    };
}
function chatToFeedItem(companyId, companyName, m, nowIso) {
    return {
        id: m.id,
        companyId,
        companyName,
        scope: 'company',
        kind: 'chat',
        from: m.sender,
        title: m.spaceName ?? '',
        snippet: clip(m.text ?? ''),
        at: sortableIso(m.createTime, nowIso),
        spaceId: m.spaceId,
        msgId: m.id,
        msgTime: m.createTime,
    };
}
function callTitle(c) {
    if (c.hasVoicemail)
        return 'Voicemail';
    if (c.outcome === 'missed')
        return 'Missed call';
    if (c.outcome === 'failed')
        return 'Failed call';
    return c.direction === 'inbound' ? 'Incoming call' : 'Outgoing call';
}
function phoneToFeedItem(companyId, companyName, i, nowIso) {
    const at = sortableIso(i.at, nowIso);
    if (i.kind === 'sms') {
        return {
            id: i.id,
            companyId,
            companyName,
            scope: 'company',
            kind: 'sms',
            from: i.counterparty,
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
        from: i.counterparty,
        title: callTitle(i),
        snippet: '',
        at,
        sid: i.sid,
        itemId: i.id,
        isVoicemail: i.hasVoicemail,
    };
}
function internalMessageToFeedItem(companyId, companyName, m, nowIso) {
    return {
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
function internalCallToFeedItem(companyId, companyName, c, nowIso) {
    return {
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
function mergeUnreadFeed(groups, opts) {
    const perCompanyCap = opts?.perCompanyCap ?? unread_feed_types_js_1.PER_COMPANY_CAP;
    const feedCap = opts?.feedCap ?? unread_feed_types_js_1.FEED_CAP;
    let truncated = false;
    const flat = [];
    for (const group of groups) {
        const sorted = [...group.items].sort(compareFeedItems);
        if (sorted.length > perCompanyCap)
            truncated = true;
        flat.push(...sorted.slice(0, perCompanyCap));
    }
    flat.sort(compareFeedItems);
    if (flat.length > feedCap)
        truncated = true;
    return { items: flat.slice(0, feedCap), truncated };
}
function compareFeedItems(a, b) {
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    if (byTime !== 0)
        return byTime;
    if (a.companyId !== b.companyId)
        return a.companyId - b.companyId;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
//# sourceMappingURL=unread-feed.util.js.map