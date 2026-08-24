import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InternalRecipientKind, Prisma } from '@prisma/client';
import { unlink } from 'fs/promises';
import * as path from 'path';
import type { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { MESSAGES_SUBDIR, resolveStoredPath } from './uploads.js';
import {
  withinRange,
  type EmailSearchFilters,
} from '../communications/email-search.js';

export type Folder = 'INBOX' | 'UNCOMPLETED' | 'UNREAD' | 'SENT';

export interface UploadedAttachment {
  originalname: string;
  mimetype: string;
  size: number;
  filename: string;
  path: string;
}

/** Page size for the inbox list — matches the client's infinite-scroll appetite. */
const PAGE_SIZE = 30;
const SNIPPET_LENGTH = 200;

/** Shape shared by list rows and detail, mirroring the client's EmailSummary. */
const messageInclude = {
  sender: { select: { id: true, name: true, email: true } },
  recipients: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  attachments: {
    select: { id: true, filename: true, mimeType: true, size: true },
  },
} satisfies Prisma.InternalMessageInclude;

type MessageWithRelations = Prisma.InternalMessageGetPayload<{
  include: typeof messageInclude;
}>;

/**
 * One forward of a message: who sent it on, to whom, and when. Exported because
 * it surfaces in the controller's inferred return types.
 */
export interface ForwardRecord {
  /** Id of the forward itself, so the UI can preview what was actually sent. */
  messageId: number;
  at: string;
  /** TO recipients of the forward, comma-joined for display. */
  to: string;
  by: { id: number; name: string };
}

/**
 * Payload carried alongside a `new-message` SSE event. Purely for display — the
 * client still refetches, so nothing here is authoritative.
 */
export interface NewMessageMeta {
  from: string;
  subject: string;
  snippet: string;
  threadId: number;
}

@Injectable()
export class InternalMessagesService {
  constructor(private prisma: PrismaService) {}

  /** Open SSE streams, keyed by an opaque client id, so we can fan out per user. */
  private sseClients = new Map<
    string,
    { userId: number; subject: Subject<{ data: string }> }
  >();

  // ── Shaping ───────────────────────────────────────────────────────────────

  private snippet(m: MessageWithRelations): string {
    const text = (m.bodyText ?? '').replace(/\s+/g, ' ').trim();
    return text.length > SNIPPET_LENGTH
      ? `${text.slice(0, SNIPPET_LENGTH)}…`
      : text;
  }

  /**
   * Project a row for `viewerId`. Read/completed come from the viewer's OWN
   * recipient row; a message the viewer sent has no such row, so it reports as
   * read and completed — it should never sit in their unread or uncompleted list.
   */
  private toSummary(m: MessageWithRelations, viewerId: number) {
    const mine = m.recipients.find((r) => r.userId === viewerId);
    const isOwn = m.senderId === viewerId;
    return {
      id: m.id,
      threadId: m.threadId ?? m.id,
      parentId: m.parentId,
      subject: m.subject,
      date: m.createdAt.toISOString(),
      snippet: this.snippet(m),
      isOwn,
      isForward: m.isForward,
      isRead: isOwn ? true : mine?.readAt != null,
      isCompleted: isOwn ? true : mine?.completedAt != null,
      from: m.sender,
      to: m.recipients
        .filter((r) => r.kind === InternalRecipientKind.TO)
        .map((r) => r.user),
      cc: m.recipients
        .filter((r) => r.kind === InternalRecipientKind.CC)
        .map((r) => r.user),
      // A blind copy is blind: the sender sees the whole list, a BCC'd user sees
      // only their own name (so they know why they received it), and everyone
      // else sees nothing at all. Filtering HERE rather than at the query is
      // deliberate — the rows must still exist for `visibleToViewer` to let the
      // BCC'd user open the message.
      bcc: m.recipients
        .filter(
          (r) =>
            r.kind === InternalRecipientKind.BCC &&
            (isOwn || r.userId === viewerId),
        )
        .map((r) => r.user),
      attachments: m.attachments,
    };
  }

  private toDetail(
    m: MessageWithRelations,
    viewerId: number,
    forwards: ForwardRecord[] = [],
  ) {
    return {
      ...this.toSummary(m, viewerId),
      bodyHtml: m.bodyHtml,
      bodyText: m.bodyText,
      // Mirrors the Communications tab's EmailDetail contract, which drives the
      // "You forwarded this message" banner. `isForward` (above) is the inverse
      // flag: it marks a message that IS a forward, this one marks a message that
      // HAS BEEN forwarded.
      isForwarded: forwards.length > 0,
      forwards,
    };
  }

  /**
   * Every forward made of `parentIds`, keyed by the message it forwarded.
   *
   * Scoped through `visibleToViewer` exactly like `getThread`: a user must never
   * learn that a colleague forwarded something to people the user isn't party to.
   * That means two people looking at the same message can legitimately see
   * different banners.
   */
  private async loadForwards(
    parentIds: number[],
    viewerId: number,
  ): Promise<Map<number, ForwardRecord[]>> {
    const byParent = new Map<number, ForwardRecord[]>();
    if (parentIds.length === 0) return byParent;

    const rows = await this.prisma.internalMessage.findMany({
      where: {
        AND: [
          this.visibleToViewer(viewerId),
          { parentId: { in: parentIds }, isForward: true },
        ],
      },
      include: messageInclude,
      orderBy: { id: 'asc' },
    });

    for (const row of rows) {
      const list = byParent.get(row.parentId!) ?? [];
      list.push({
        messageId: row.id,
        at: row.createdAt.toISOString(),
        to: row.recipients
          .filter((r) => r.kind === InternalRecipientKind.TO)
          .map((r) => r.user.name)
          .join(', '),
        by: { id: row.sender.id, name: row.sender.name },
      });
      byParent.set(row.parentId!, list);
    }
    return byParent;
  }

  // ── Access control ────────────────────────────────────────────────────────

  /**
   * The single source of truth for "can this user see this message": they either
   * sent it or were addressed on it. Every read path funnels through here rather
   * than trusting an id from the client.
   */
  private visibleToViewer(viewerId: number): Prisma.InternalMessageWhereInput {
    return {
      deletedAt: null,
      OR: [
        { senderId: viewerId },
        { recipients: { some: { userId: viewerId } } },
      ],
    };
  }

  private async loadVisible(id: number, viewerId: number) {
    const message = await this.prisma.internalMessage.findFirst({
      where: { id, ...this.visibleToViewer(viewerId) },
      include: messageInclude,
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private folderWhere(
    folder: Folder,
    viewerId: number,
  ): Prisma.InternalMessageWhereInput {
    switch (folder) {
      case 'SENT':
        return { deletedAt: null, senderId: viewerId };
      case 'UNREAD':
        return {
          deletedAt: null,
          recipients: { some: { userId: viewerId, readAt: null } },
        };
      case 'UNCOMPLETED':
        return {
          deletedAt: null,
          recipients: { some: { userId: viewerId, completedAt: null } },
        };
      case 'INBOX':
      default:
        return {
          deletedAt: null,
          recipients: { some: { userId: viewerId } },
        };
    }
  }

  /**
   * Prisma clauses for the advanced-search panel's fields.
   *
   * Returned as an ARRAY to be spread into an `AND`, never merged into the outer
   * where: several of these contribute their own `OR` key, and two `OR`s in one
   * object literal silently discard the first — the same collision documented on
   * `getThread`, which there would leak a whole thread.
   */
  private searchClauses(
    f: EmailSearchFilters,
    viewerId: number,
  ): Prisma.InternalMessageWhereInput[] {
    const and: Prisma.InternalMessageWhereInput[] = [];
    const person = (value: string) => ({
      OR: [
        { name: { contains: value } },
        { email: { contains: value } },
      ],
    });

    if (f.from) and.push({ sender: person(f.from) });

    if (f.to) {
      const match = person(f.to);
      // A blind copy stays blind: searching by recipient must not let a To/Cc
      // recipient discover who was BCC'd. Only the sender can match on those.
      and.push({
        OR: [
          {
            recipients: {
              some: {
                kind: {
                  in: [InternalRecipientKind.TO, InternalRecipientKind.CC],
                },
                user: match,
              },
            },
          },
          {
            senderId: viewerId,
            recipients: {
              some: { kind: InternalRecipientKind.BCC, user: match },
            },
          },
        ],
      });
    }

    if (f.subject) and.push({ subject: { contains: f.subject } });
    if (f.words) {
      and.push({
        OR: [
          { subject: { contains: f.words } },
          { bodyText: { contains: f.words } },
        ],
      });
    }
    if (f.notWords) {
      and.push({
        NOT: {
          OR: [
            { subject: { contains: f.notWords } },
            { bodyText: { contains: f.notWords } },
          ],
        },
      });
    }
    if (f.within) {
      const { after, before } = withinRange(f.within, f.anchor);
      and.push({ createdAt: { gte: after, lte: before } });
    }
    if (f.hasAttachment) and.push({ attachments: { some: {} } });
    // `sizeBytes` and `scope` are email-only — internal messages store no size and
    // have no mail folders. The panel hides both for this variant.
    return and;
  }

  async list(
    viewerId: number,
    folder: Folder,
    cursor?: number,
    q?: string,
    filters?: EmailSearchFilters,
  ): Promise<{
    messages: ReturnType<InternalMessagesService['toSummary']>[];
    nextCursor: number | null;
  }> {
    const search = q?.trim();
    const messages = await this.prisma.internalMessage.findMany({
      where: {
        AND: [
          this.folderWhere(folder, viewerId),
          ...(search
            ? [
                {
                  OR: [
                    { subject: { contains: search } },
                    { bodyText: { contains: search } },
                  ],
                },
              ]
            : []),
          ...(filters ? this.searchClauses(filters, viewerId) : []),
        ],
      },
      include: messageInclude,
      // id is autoincrement so it orders identically to createdAt but is a stable,
      // collision-free cursor even for messages sent in the same millisecond.
      orderBy: { id: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = messages.length > PAGE_SIZE;
    const page = hasMore ? messages.slice(0, PAGE_SIZE) : messages;
    return {
      messages: page.map((m) => this.toSummary(m, viewerId)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getOne(id: number, viewerId: number) {
    const message = await this.loadVisible(id, viewerId);
    const forwards = await this.loadForwards([message.id], viewerId);
    return this.toDetail(message, viewerId, forwards.get(message.id) ?? []);
  }

  /**
   * Every message in a thread that the viewer is party to, oldest first.
   *
   * Note the explicit `AND`: `visibleToViewer` contributes its own `OR` key, and
   * spreading it alongside a second `OR` would silently drop the access guard —
   * leaking the whole thread. Nesting both under AND keeps them independent.
   */
  async getThread(threadId: number, viewerId: number) {
    const messages = await this.prisma.internalMessage.findMany({
      where: {
        AND: [
          this.visibleToViewer(viewerId),
          { OR: [{ threadId }, { id: threadId }] },
        ],
      },
      include: messageInclude,
      orderBy: { id: 'asc' },
    });
    // One extra query for the whole thread, not one per message.
    const forwards = await this.loadForwards(
      messages.map((m) => m.id),
      viewerId,
    );
    return {
      messages: messages.map((m) =>
        this.toDetail(m, viewerId, forwards.get(m.id) ?? []),
      ),
    };
  }

  /** Badge count: messages addressed to me that I haven't completed. */
  async getUncompletedCount(viewerId: number): Promise<number> {
    return this.prisma.internalMessageRecipient.count({
      where: {
        userId: viewerId,
        completedAt: null,
        message: { deletedAt: null },
      },
    });
  }

  async getUnreadCount(viewerId: number): Promise<number> {
    return this.prisma.internalMessageRecipient.count({
      where: { userId: viewerId, readAt: null, message: { deletedAt: null } },
    });
  }

  // ── State mutations ───────────────────────────────────────────────────────

  /**
   * Flip read/completed on the viewer's own recipient row. Sender-only messages
   * have no row, so `updateMany` no-ops rather than throwing — the UI hides these
   * toggles for sent mail anyway.
   */
  private async setState(
    id: number,
    viewerId: number,
    data: Prisma.InternalMessageRecipientUpdateManyMutationInput,
  ) {
    // Same predicate as loadVisible, but a toggle only needs "may I see it?" —
    // pulling the whole relation graph here just to discard it made the round
    // trip noticeably slower.
    const visible = await this.prisma.internalMessage.findFirst({
      where: { id, ...this.visibleToViewer(viewerId) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException('Message not found');
    await this.prisma.internalMessageRecipient.updateMany({
      where: { messageId: id, userId: viewerId },
      data,
    });
  }

  markRead(id: number, viewerId: number) {
    return this.setState(id, viewerId, { readAt: new Date() });
  }

  markUnread(id: number, viewerId: number) {
    return this.setState(id, viewerId, { readAt: null });
  }

  markComplete(id: number, viewerId: number) {
    return this.setState(id, viewerId, { completedAt: new Date() });
  }

  markUncomplete(id: number, viewerId: number) {
    return this.setState(id, viewerId, { completedAt: null });
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async send(
    senderId: number,
    input: {
      to: number[];
      cc: number[];
      bcc: number[];
      subject?: string;
      body: string;
      bodyHtml?: string;
      parentId?: number;
      isForward?: boolean;
    },
    files: UploadedAttachment[],
  ) {
    // A user can land on more than one of To/Cc/Bcc from a sloppy client; the
    // most visible field wins (To > Cc > Bcc), and the (messageId, userId) unique
    // constraint would otherwise reject the insert. Demoting to Bcc would also be
    // wrong: it would hide a recipient the sender addressed openly.
    const toIds = input.to.filter((id) => id !== senderId);
    const ccIds = input.cc.filter(
      (id) => id !== senderId && !toIds.includes(id),
    );
    const bccIds = input.bcc.filter(
      (id) =>
        id !== senderId && !toIds.includes(id) && !ccIds.includes(id),
    );
    const allIds = [...toIds, ...ccIds, ...bccIds];

    if (allIds.length === 0) {
      await this.discardFiles(files);
      throw new BadRequestException('At least one recipient is required');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: allIds }, deletedAt: null },
      select: { id: true },
    });
    if (users.length !== allIds.length) {
      await this.discardFiles(files);
      throw new BadRequestException('One or more recipients no longer exist');
    }

    // A reply inherits the parent's thread. A forward does NOT: like email, it
    // starts its own conversation, and the original only shows the "You forwarded
    // this message" banner. `parentId` is still stored either way — that link is
    // what `loadForwards` reads to build the banner.
    let threadId: number | null = null;
    if (input.parentId) {
      const parent = await this.prisma.internalMessage.findFirst({
        where: { id: input.parentId, ...this.visibleToViewer(senderId) },
        select: { id: true, threadId: true },
      });
      if (!parent) {
        await this.discardFiles(files);
        throw new NotFoundException('Message being replied to was not found');
      }
      // null here means "root yourself", handled after the create below.
      threadId = input.isForward ? null : (parent.threadId ?? parent.id);
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.internalMessage.create({
        data: {
          senderId,
          subject: input.subject?.trim() || '(no subject)',
          bodyText: input.body,
          bodyHtml: input.bodyHtml ?? null,
          parentId: input.parentId ?? null,
          isForward: input.isForward ?? false,
          // A fresh message is its own thread root; set below once we have an id.
          threadId,
          recipients: {
            create: [
              ...toIds.map((userId) => ({
                userId,
                kind: InternalRecipientKind.TO,
              })),
              ...ccIds.map((userId) => ({
                userId,
                kind: InternalRecipientKind.CC,
              })),
              ...bccIds.map((userId) => ({
                userId,
                kind: InternalRecipientKind.BCC,
              })),
            ],
          },
          ...(files.length && {
            attachments: {
              create: files.map((f) => ({
                filename: f.originalname,
                mimeType: f.mimetype,
                size: f.size,
                // Store relative to the uploads root so the root can move between
                // environments without rewriting every row.
                storagePath: path.posix.join(MESSAGES_SUBDIR, f.filename),
              })),
            },
          }),
        },
        include: messageInclude,
      });

      if (threadId === null) {
        return tx.internalMessage.update({
          where: { id: created.id },
          data: { threadId: created.id },
          include: messageInclude,
        });
      }
      return created;
    });

    // Push to every recipient with an open stream so the row appears instantly.
    // The metadata rides along so the client can name the sender in a desktop
    // notification without a follow-up fetch (it has no other source: the inbox
    // list query only exists while the Messages tab is mounted).
    for (const userId of allIds) {
      this.broadcastNewMessage(userId, {
        from: message.sender.name,
        subject: message.subject,
        snippet: this.snippet(message),
        threadId: message.threadId ?? message.id,
      });
    }

    return this.toDetail(message, senderId);
  }

  /** Best-effort cleanup of uploaded files when a send is rejected. */
  private async discardFiles(files: UploadedAttachment[]) {
    await Promise.allSettled(files.map((f) => unlink(f.path)));
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  /**
   * Look up an attachment, enforcing that the requesting user can see its parent
   * message. The download route has no guard (the token rides in the query string
   * so URLs work as <img>/<video> src), which makes this check the only thing
   * standing between a valid token and someone else's files.
   */
  async getAttachment(attachmentId: number, viewerId: number) {
    const attachment = await this.prisma.internalMessageAttachment.findFirst({
      where: {
        id: attachmentId,
        message: this.visibleToViewer(viewerId),
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return {
      ...attachment,
      absolutePath: resolveStoredPath(attachment.storagePath),
    };
  }

  // ── SSE ───────────────────────────────────────────────────────────────────

  addSseClient(id: string, userId: number, subject: Subject<{ data: string }>) {
    this.sseClients.set(id, { userId, subject });
  }

  removeSseClient(id: string) {
    this.sseClients.delete(id);
  }

  /**
   * Notify one user's open tabs. Unlike the Gmail equivalent there is no webhook
   * or Pub/Sub involved — we own the write path, so this is a direct call at the
   * end of `send()`.
   *
   * `meta` is optional and the client treats every field as optional, so an older
   * client keeps working against a newer server and vice versa.
   */
  broadcastNewMessage(userId: number, meta?: NewMessageMeta) {
    const data = JSON.stringify({ type: 'new-message', ...meta });
    for (const [, client] of this.sseClients) {
      if (client.userId === userId) {
        client.subject.next({ data });
      }
    }
  }
}
