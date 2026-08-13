import { open } from 'fs/promises';

// ─── Microsoft Graph REST transport ──────────────────────────────────────────
// Thin wrapper over global fetch against Graph v1.0. Using REST directly (rather
// than the Graph SDK) keeps behavior predictable and avoids SDK version drift; the
// paths mirror the ones documented on learn.microsoft.com/graph/api.

const GRAPH = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(
    public status: number,
    public graphCode: string | null,
    message: string,
    // The `WWW-Authenticate` challenge (present on 401s whose body is empty) —
    // this is where Graph puts the real reason: expired token, invalid audience,
    // "CompactToken parsing failed", etc.
    public wwwAuthenticate: string | null = null,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

// Pull the human-readable reason out of a `WWW-Authenticate: Bearer …` header:
// prefer `error_description`, fall back to `error`.
function parseAuthChallenge(header: string | null): string | null {
  if (!header) return null;
  const desc = /error_description="([^"]+)"/i.exec(header);
  if (desc) return desc[1];
  const err = /error="([^"]+)"/i.exec(header);
  return err ? err[1] : null;
}

async function graphFetch(
  accessToken: string,
  urlOrPath: string,
  init?: RequestInit,
): Promise<Response> {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${GRAPH}${urlOrPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let code: string | null = null;
    let message = `Graph ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? null;
      message = body.error?.message ?? message;
    } catch {
      // non-JSON error body
    }
    // 401s (and some others) carry the real reason in WWW-Authenticate, not the
    // body — surface it so logs aren't a useless bare "Graph 401".
    const wwwAuth = res.headers.get('www-authenticate');
    const reason = parseAuthChallenge(wwwAuth);
    if (reason && message === `Graph ${res.status}`) {
      message = `Graph ${res.status}: ${reason}`;
    }
    throw new GraphError(res.status, code, message, wwwAuth);
  }
  return res;
}

export async function graphGet<T>(
  accessToken: string,
  urlOrPath: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await graphFetch(accessToken, urlOrPath, { headers });
  return (await res.json()) as T;
}

export async function graphPost<T>(
  accessToken: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T | null> {
  const res = await graphFetch(accessToken, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  if (res.status === 202 || res.status === 204) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function graphPatch(
  accessToken: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<void> {
  await graphFetch(accessToken, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

export async function graphDelete(
  accessToken: string,
  path: string,
): Promise<void> {
  await graphFetch(accessToken, path, { method: 'DELETE' });
}

/**
 * Streams a file to a Graph upload session in chunks.
 *
 * Used by both the mail-attachment session (`…/attachments/createUploadSession`)
 * and the OneDrive one (`/me/drive/root:/…:/createUploadSession`) — they take the
 * same PUT-with-Content-Range protocol. Bytes are read straight off disk a chunk
 * at a time, so a 250 MB attachment never lands in this process's heap.
 *
 * Returns the JSON body of the final response (the created attachment/DriveItem).
 */
export async function uploadFileInChunks<T>(
  uploadUrl: string,
  filePath: string,
  total: number,
  label: string,
): Promise<T | null> {
  // Graph requires every chunk except the last to be a multiple of 320 KiB.
  const CHUNK = 320 * 1024 * 10;
  const handle = await open(filePath, 'r');
  const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(total, 1)));
  try {
    let last: T | null = null;
    for (let start = 0; start < total; start += CHUNK) {
      const length = Math.min(CHUNK, total - start);
      const { bytesRead } = await handle.read(buf, 0, length, start);
      const res = await fetch(uploadUrl, {
        // The upload URL is pre-authorized, so it takes no Authorization header.
        // Content-Length is set by the runtime; setting it here is rejected.
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${start}-${start + bytesRead - 1}/${total}`,
        },
        // Copy rather than hand over a view of the reused scratch buffer.
        body: new Uint8Array(buf.subarray(0, bytesRead)),
      });
      if (!res.ok) {
        throw new Error(`Upload failed for "${label}" (${res.status})`);
      }
      const text = await res.text();
      if (text) {
        try {
          last = JSON.parse(text) as T;
        } catch {
          // interim 202 Accepted bodies aren't always JSON
        }
      }
    }
    return last;
  } finally {
    await handle.close();
  }
}

/** Raw bytes from a `…/$value` endpoint (attachment / hosted content download). */
export async function graphGetBinary(
  accessToken: string,
  path: string,
): Promise<Buffer> {
  const res = await graphFetch(accessToken, path);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Graph response shapes (only the fields we use) ──────────────────────────

export interface GraphList<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export interface GraphEmailAddress {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  from?: GraphEmailAddress;
  sender?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  conversationId?: string;
  internetMessageId?: string;
  body?: { contentType?: string; content?: string };
  attachments?: GraphAttachment[];
}

export interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
  '@odata.type'?: string;
}

export interface GraphChatMember {
  displayName?: string;
  userId?: string;
}

export interface GraphChatMessageAttachment {
  id?: string;
  contentType?: string;
  contentUrl?: string;
  name?: string;
  thumbnailUrl?: string;
}

export interface GraphChatMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  from?: { user?: { id?: string; displayName?: string } };
  body?: { contentType?: string; content?: string };
  attachments?: GraphChatMessageAttachment[];
}

export interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  members?: GraphChatMember[];
  lastMessagePreview?: GraphChatMessage;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Format a Graph address as the RFC "Name <email>" string the DTOs use. */
export function formatGraphAddress(a?: GraphEmailAddress): string {
  const name = a?.emailAddress?.name?.trim();
  const address = a?.emailAddress?.address?.trim() ?? '';
  if (name && name !== address) return `${name} <${address}>`;
  return address;
}

export function formatGraphAddressList(list?: GraphEmailAddress[]): string {
  return (list ?? []).map(formatGraphAddress).filter(Boolean).join(', ');
}

/** Collapse Teams HTML message bodies to readable plain text for the inbox/thread. */
export function htmlToText(html: string | undefined | null): string {
  if (!html) return '';
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

// Teams chat ids and message ids have no "/", so they'd collide with Outlook email
// ids in the shared state tables. Namespace every Teams message id the client sees
// so read/completed state can't cross-contaminate. See MessageStateService.
export const TEAMS_PREFIX = 'msteams:';

export function teamsStateId(chatId: string, messageId: string): string {
  return `${TEAMS_PREFIX}${chatId}:${messageId}`;
}

/** The display name for a chat: its topic, else the other members' names. */
export function chatDisplayName(
  chat: GraphChat,
  selfUserId: string | null,
): string {
  if (chat.topic) return chat.topic;
  const others = (chat.members ?? [])
    .filter((m) => m.userId && m.userId !== selfUserId)
    .map((m) => m.displayName)
    .filter((n): n is string => !!n);
  if (others.length) return others.join(', ');
  return chat.chatType === 'group' ? 'Group chat' : 'Chat';
}

/** Map Graph chatType to the spaceType vocabulary the client expects. */
export function chatSpaceType(chatType: string | undefined): string {
  return chatType === 'oneOnOne' ? 'DIRECT_MESSAGE' : 'SPACE';
}
