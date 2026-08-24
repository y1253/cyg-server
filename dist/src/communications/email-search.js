"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEmailSearchFilters = parseEmailSearchFilters;
exports.withinRange = withinRange;
exports.buildGmailQuery = buildGmailQuery;
exports.buildGraphSearch = buildGraphSearch;
exports.resolveScopeLabels = resolveScopeLabels;
const WITHIN_DAYS = {
    '1d': 1,
    '3d': 3,
    '1w': 7,
    '2w': 14,
    '1m': 30,
    '2m': 60,
    '6m': 182,
    '1y': 365,
};
const SCOPES = ['all', 'inbox', 'sent', 'spam', 'trash'];
const WITHINS = Object.keys(WITHIN_DAYS);
function clean(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function parseEmailSearchFilters(query) {
    const size = Number(query.sizeBytes);
    const sizeOp = query.sizeOp === 'gt' || query.sizeOp === 'lt' ? query.sizeOp : undefined;
    const within = WITHINS.includes(query.within)
        ? query.within
        : undefined;
    const scope = SCOPES.includes(query.scope)
        ? query.scope
        : undefined;
    const filters = {
        from: clean(query.from),
        to: clean(query.to),
        subject: clean(query.subject),
        words: clean(query.words),
        notWords: clean(query.notWords),
        ...(sizeOp && Number.isFinite(size) && size > 0
            ? { sizeOp, sizeBytes: Math.floor(size) }
            : {}),
        within,
        anchor: /^\d{4}-\d{2}-\d{2}$/.test(query.anchor ?? '')
            ? query.anchor
            : undefined,
        hasAttachment: query.hasAttachment === 'true' || query.hasAttachment === '1',
        scope,
    };
    const meaningful = filters.from ??
        filters.to ??
        filters.subject ??
        filters.words ??
        filters.notWords ??
        filters.sizeBytes ??
        filters.within ??
        (filters.hasAttachment || undefined) ??
        (filters.scope && filters.scope !== 'inbox' ? filters.scope : undefined);
    return meaningful === undefined ? undefined : filters;
}
function withinRange(within, anchor) {
    const centre = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
    const days = WITHIN_DAYS[within];
    const ms = days * 86400000;
    return {
        after: new Date(centre.getTime() - ms),
        before: new Date(centre.getTime() + ms),
    };
}
function gmailDate(d) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
function quote(value) {
    return `"${value.replace(/"/g, '')}"`;
}
function buildGmailQuery(free, f) {
    const parts = [];
    const freeText = clean(free);
    if (freeText)
        parts.push(freeText);
    if (f?.from)
        parts.push(`from:${quote(f.from)}`);
    if (f?.to)
        parts.push(`to:${quote(f.to)}`);
    if (f?.subject)
        parts.push(`subject:${quote(f.subject)}`);
    if (f?.words)
        parts.push(f.words);
    if (f?.notWords)
        parts.push(`-${quote(f.notWords)}`);
    if (f?.sizeBytes) {
        parts.push(`${f.sizeOp === 'lt' ? 'smaller' : 'larger'}:${f.sizeBytes}`);
    }
    if (f?.within) {
        const { after, before } = withinRange(f.within, f.anchor);
        parts.push(`after:${gmailDate(after)}`, `before:${gmailDate(before)}`);
    }
    if (f?.hasAttachment)
        parts.push('has:attachment');
    if (f?.scope === 'all')
        parts.push('-in:spam', '-in:trash');
    return parts.length > 0 ? parts.join(' ') : undefined;
}
function buildGraphSearch(free, f) {
    const parts = [];
    const freeText = clean(free);
    if (freeText)
        parts.push(freeText);
    if (f?.from)
        parts.push(`from:${quote(f.from)}`);
    if (f?.to)
        parts.push(`to:${quote(f.to)}`);
    if (f?.subject)
        parts.push(`subject:${quote(f.subject)}`);
    if (f?.words)
        parts.push(f.words);
    if (f?.notWords)
        parts.push(`NOT(${quote(f.notWords)})`);
    if (f?.sizeBytes) {
        parts.push(`size${f.sizeOp === 'lt' ? '<' : '>'}${f.sizeBytes}`);
    }
    if (f?.within) {
        const { after, before } = withinRange(f.within, f.anchor);
        parts.push(`received>=${isoDate(after)}`, `received<=${isoDate(before)}`);
    }
    if (f?.hasAttachment)
        parts.push('hasAttachments:true');
    return parts.length > 0 ? parts.join(' AND ') : undefined;
}
function resolveScopeLabels(labelIds, scope) {
    if (!scope)
        return labelIds;
    switch (scope) {
        case 'all':
            return ['ALL'];
        case 'sent':
            return ['SENT'];
        case 'spam':
            return ['SPAM'];
        case 'trash':
            return ['TRASH'];
        case 'inbox':
        default:
            return ['INBOX'];
    }
}
//# sourceMappingURL=email-search.js.map