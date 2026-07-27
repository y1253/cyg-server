"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEAMS_PREFIX = exports.GraphError = void 0;
exports.graphGet = graphGet;
exports.graphPost = graphPost;
exports.graphPatch = graphPatch;
exports.graphDelete = graphDelete;
exports.graphGetBinary = graphGetBinary;
exports.formatGraphAddress = formatGraphAddress;
exports.formatGraphAddressList = formatGraphAddressList;
exports.htmlToText = htmlToText;
exports.teamsStateId = teamsStateId;
exports.chatDisplayName = chatDisplayName;
exports.chatSpaceType = chatSpaceType;
const GRAPH = 'https://graph.microsoft.com/v1.0';
class GraphError extends Error {
    status;
    graphCode;
    wwwAuthenticate;
    constructor(status, graphCode, message, wwwAuthenticate = null) {
        super(message);
        this.status = status;
        this.graphCode = graphCode;
        this.wwwAuthenticate = wwwAuthenticate;
        this.name = 'GraphError';
    }
}
exports.GraphError = GraphError;
function parseAuthChallenge(header) {
    if (!header)
        return null;
    const desc = /error_description="([^"]+)"/i.exec(header);
    if (desc)
        return desc[1];
    const err = /error="([^"]+)"/i.exec(header);
    return err ? err[1] : null;
}
async function graphFetch(accessToken, urlOrPath, init) {
    const url = urlOrPath.startsWith('http') ? urlOrPath : `${GRAPH}${urlOrPath}`;
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init?.headers ?? {}),
        },
    });
    if (!res.ok) {
        let code = null;
        let message = `Graph ${res.status}`;
        try {
            const body = (await res.json());
            code = body.error?.code ?? null;
            message = body.error?.message ?? message;
        }
        catch {
        }
        const wwwAuth = res.headers.get('www-authenticate');
        const reason = parseAuthChallenge(wwwAuth);
        if (reason && message === `Graph ${res.status}`) {
            message = `Graph ${res.status}: ${reason}`;
        }
        throw new GraphError(res.status, code, message, wwwAuth);
    }
    return res;
}
async function graphGet(accessToken, urlOrPath, headers) {
    const res = await graphFetch(accessToken, urlOrPath, { headers });
    return (await res.json());
}
async function graphPost(accessToken, path, body, headers) {
    const res = await graphFetch(accessToken, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
        body: JSON.stringify(body),
    });
    if (res.status === 202 || res.status === 204)
        return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}
async function graphPatch(accessToken, path, body) {
    await graphFetch(accessToken, path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}
async function graphDelete(accessToken, path) {
    await graphFetch(accessToken, path, { method: 'DELETE' });
}
async function graphGetBinary(accessToken, path) {
    const res = await graphFetch(accessToken, path);
    return Buffer.from(await res.arrayBuffer());
}
function formatGraphAddress(a) {
    const name = a?.emailAddress?.name?.trim();
    const address = a?.emailAddress?.address?.trim() ?? '';
    if (name && name !== address)
        return `${name} <${address}>`;
    return address;
}
function formatGraphAddressList(list) {
    return (list ?? []).map(formatGraphAddress).filter(Boolean).join(', ');
}
function htmlToText(html) {
    if (!html)
        return '';
    return html
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(p|div|li)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
exports.TEAMS_PREFIX = 'msteams:';
function teamsStateId(chatId, messageId) {
    return `${exports.TEAMS_PREFIX}${chatId}:${messageId}`;
}
function chatDisplayName(chat, selfUserId) {
    if (chat.topic)
        return chat.topic;
    const others = (chat.members ?? [])
        .filter((m) => m.userId && m.userId !== selfUserId)
        .map((m) => m.displayName)
        .filter((n) => !!n);
    if (others.length)
        return others.join(', ');
    return chat.chatType === 'group' ? 'Group chat' : 'Chat';
}
function chatSpaceType(chatType) {
    return chatType === 'oneOnOne' ? 'DIRECT_MESSAGE' : 'SPACE';
}
//# sourceMappingURL=graph.util.js.map