import * as os from 'os';
import * as path from 'path';
import { rm, writeFile } from 'fs/promises';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { google } from 'googleapis';
import { GmailService } from './gmail.service';
import { SaveDraftDto } from './dto/save-draft.dto';
import { SendEmailDto } from './dto/send-email.dto';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessageStateService } from '../communications/message-state.service';

/**
 * Provider-backed drafts, and the three things about them that are easy to get
 * silently wrong.
 *
 * 1. A draft is saved seconds after the user starts typing, so it has to be
 *    saveable with NO recipient — while a send with no recipient stays a 400.
 * 2. A draft has TWO Gmail ids and every write is keyed by the DRAFT one. Listing
 *    messages instead of drafts hands the client the message id, and every
 *    subsequent autosave 404s.
 * 3. A draft's body is MUTABLE. `messageCache` exists only because a sent message's
 *    body never changes; serving a draft row from it shows the user their message as
 *    it was up to six hours ago.
 */
describe('SaveDraftDto vs SendEmailDto — the empty recipient', () => {
  const errorsFor = async <T extends object>(
    cls: new () => T,
    body: Record<string, unknown>,
  ) => validate(plainToInstance(cls, body));

  it('saves a draft with no recipient at all', async () => {
    expect(await errorsFor(SaveDraftDto, { body: 'half a thought' })).toEqual(
      [],
    );
  });

  it('saves a draft whose recipient is still an empty string', async () => {
    expect(await errorsFor(SaveDraftDto, { to: '', body: '' })).toEqual([]);
  });

  // The relaxation is about EMPTINESS only. A half-typed address must still be
  // caught here, or the write fails at Gmail with an error the composer cannot
  // explain to anyone.
  it('still rejects a half-typed address on a draft', async () => {
    const errs = await errorsFor(SaveDraftDto, { to: 'bob@', body: '' });
    expect(errs).toHaveLength(1);
    expect(errs[0].property).toBe('to');
  });

  it('still rejects one bad address among several on a draft', async () => {
    const errs = await errorsFor(SaveDraftDto, {
      to: 'a@b.com, nope',
      body: '',
    });
    expect(errs).toHaveLength(1);
  });

  it('accepts a valid list on a draft', async () => {
    expect(
      await errorsFor(SaveDraftDto, { to: 'a@b.com, c@d.com', body: '' }),
    ).toEqual([]);
  });

  // The other half of the contract: relaxing the draft must not have relaxed the
  // send. Pressing Send with no recipient is a genuine 400 and always was.
  it('a SEND with no recipient is still rejected', async () => {
    const errs = await errorsFor(SendEmailDto, { body: 'hello' });
    expect(errs.some((e) => e.property === 'to')).toBe(true);
  });

  it('a SEND with an empty recipient is still rejected', async () => {
    const errs = await errorsFor(SendEmailDto, { to: '', body: 'hello' });
    expect(errs.some((e) => e.property === 'to')).toBe(true);
  });
});

describe('the Drafts folder', () => {
  const COMPANY = 42;

  let svc: GmailService;
  let messagesList: jest.Mock;
  let messagesGet: jest.Mock;
  let draftsList: jest.Mock;

  const message = (id: string, to = 'client@example.com') => ({
    data: {
      threadId: `t-${id}`,
      snippet: `snippet ${id}`,
      payload: {
        headers: [
          { name: 'Subject', value: `subject ${id}` },
          { name: 'From', value: 'us@cygfinance.com' },
          { name: 'To', value: to },
          { name: 'Date', value: 'Mon, 1 Sep 2026 10:00:00 +0000' },
        ],
      },
    },
  });

  beforeEach(() => {
    messagesGet = jest.fn((args: { id: string }) =>
      Promise.resolve(message(args.id)),
    );
    messagesList = jest.fn(() =>
      Promise.resolve({ data: { messages: [], nextPageToken: null } }),
    );
    draftsList = jest.fn(() =>
      Promise.resolve({
        data: {
          drafts: [
            { id: 'r-111', message: { id: 'm-111', threadId: 't-m-111' } },
            { id: 'r-222', message: { id: 'm-222', threadId: 't-m-222' } },
          ],
          nextPageToken: null,
        },
      }),
    );

    jest.spyOn(google, 'gmail').mockReturnValue({
      users: {
        messages: { list: messagesList, get: messagesGet },
        drafts: { list: draftsList },
      },
    } as unknown as ReturnType<typeof google.gmail>);

    svc = new GmailService(
      {} as PrismaService,
      {
        getCompletedSet: () =>
          Promise.resolve(new Set<string>(['r-111', 'm-111'])),
        getForwardedSet: () =>
          Promise.resolve(new Set<string>(['r-111', 'm-111'])),
      } as unknown as MessageStateService,
    );

    (
      svc as unknown as { ensureFreshTokens: () => Promise<unknown> }
    ).ensureFreshTokens = jest.fn().mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists drafts through drafts.list, not messages.list', async () => {
    await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    expect(draftsList).toHaveBeenCalledTimes(1);
    // messages.list still runs once for the unread set, but never to enumerate the
    // folder itself — and never with a DRAFT label.
    const listArgs = messagesList.mock.calls as [{ labelIds?: string[] }][];
    for (const [args] of listArgs) {
      expect(args.labelIds ?? []).not.toContain('DRAFT');
    }
  });

  /**
   * The one that breaks autosave if it regresses: every write is keyed by the draft
   * id, so a row carrying the message id would 404 on the user's next keystroke.
   */
  it('keys each row by the DRAFT id, not the message id', async () => {
    const res = await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    expect(res.messages.map((m) => m.id)).toEqual(['r-111', 'r-222']);
  });

  it('carries the recipients, which is all that distinguishes one draft row', async () => {
    const res = await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    expect(res.messages[0].to).toBe('client@example.com');
  });

  /**
   * A draft is your own unsent message: there is nothing to tick off, and a state row
   * written under a draft id orphans the moment the draft is sent. Both state sets
   * above deliberately contain the draft's ids, so a row that consulted them would
   * come back `true`.
   */
  it('takes no part in read or completed state', async () => {
    const res = await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    for (const m of res.messages) {
      expect(m.isRead).toBe(true);
      expect(m.isCompleted).toBe(false);
      expect(m.isForwarded).toBe(false);
    }
  });

  /**
   * `messageCache` is safe for sent mail because a delivered body never changes. A
   * draft's does, on every autosave — so the Drafts folder must re-fetch every time.
   */
  it('never serves a draft body from the immutable-body cache', async () => {
    await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    expect(messagesGet).toHaveBeenCalledTimes(2);

    await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    expect(messagesGet).toHaveBeenCalledTimes(4); // re-read, not cached
  });

  /** ...and it must not poison the cache for everybody else either. */
  it('does not write draft bodies into the cache for the inbox to find', async () => {
    await svc.getEmails(COMPANY, undefined, ['DRAFT']);
    messagesList.mockResolvedValue({
      data: { messages: [{ id: 'm-111' }], nextPageToken: null },
    });
    messagesGet.mockClear();

    await svc.getEmails(COMPANY);
    // A cached draft body would make this zero.
    expect(messagesGet).toHaveBeenCalledTimes(1);
  });
});

/**
 * `drafts.update` REPLACES the whole message, so an update built from the DTO alone
 * deletes any attachment the draft already had. The server defends against that by
 * re-reading the draft first — which is a whole extra Gmail request per
 * keystroke-pause, on mailboxes already near the per-user rate limit.
 *
 * The composer knows whether the draft has attachments, because it listed them when
 * it opened it. These tests pin both halves: the hint makes the common case free, and
 * the ABSENCE of a hint keeps the safe behaviour.
 */
describe('updateDraft — protecting attachments without paying for it', () => {
  const COMPANY = 7;
  const DRAFT = 'r-abc';

  let svc: GmailService;
  let draftsGet: jest.Mock;
  let draftsUpdate: jest.Mock;

  beforeEach(() => {
    draftsGet = jest.fn(() =>
      Promise.resolve({
        data: {
          id: DRAFT,
          message: {
            id: 'm-abc',
            threadId: 't-abc',
            payload: { headers: [{ name: 'To', value: 'a@b.com' }] },
          },
        },
      }),
    );
    draftsUpdate = jest.fn(() =>
      Promise.resolve({ data: { id: DRAFT, message: { id: 'm-abc' } } }),
    );

    jest.spyOn(google, 'gmail').mockReturnValue({
      users: {
        drafts: { get: draftsGet, update: draftsUpdate },
      },
    } as unknown as ReturnType<typeof google.gmail>);

    svc = new GmailService(
      {
        gmailAccount: {
          findUnique: () =>
            Promise.resolve({ scope: '', gmailAddress: 'us@cygfinance.com' }),
        },
      } as unknown as PrismaService,
      {} as unknown as MessageStateService,
    );

    (
      svc as unknown as { ensureFreshTokens: () => Promise<unknown> }
    ).ensureFreshTokens = jest.fn().mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips the protective read when the composer says there are no attachments', async () => {
    await svc.updateDraft(COMPANY, DRAFT, {
      subject: 'hi',
      body: 'there',
      hasAttachments: 'false',
    });
    // The whole point: one request, not two.
    expect(draftsGet).not.toHaveBeenCalled();
    expect(draftsUpdate).toHaveBeenCalledTimes(1);
  });

  /**
   * The safe default. A client that says nothing — an older build, or one that could
   * not tell — must never lose a file to this optimisation.
   */
  it('re-reads the draft when the caller says nothing', async () => {
    await svc.updateDraft(COMPANY, DRAFT, { subject: 'hi', body: 'there' });
    expect(draftsGet).toHaveBeenCalledTimes(1);
    expect(draftsUpdate).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the caller says there ARE attachments', async () => {
    await svc.updateDraft(COMPANY, DRAFT, {
      subject: 'hi',
      body: 'there',
      hasAttachments: 'true',
    });
    expect(draftsGet).toHaveBeenCalledTimes(1);
  });

  // An update that carries its own files is declaring the full set (an add or a
  // remove), so there is nothing to carry over and nothing to read.
  it('skips the read when the caller supplies its own files', async () => {
    // A real file: prepareOutbound reads attachment bytes off disk, and the point of
    // this test is the branch AFTER that, not a staging failure.
    const staged = path.join(os.tmpdir(), `cyg-draft-test-${Date.now()}.txt`);
    await writeFile(staged, 'x');
    try {
      await svc.updateDraft(COMPANY, DRAFT, { subject: 'hi', body: 'there' }, [
        {
          originalname: 'a.txt',
          mimetype: 'text/plain',
          size: 1,
          path: staged,
        },
      ]);
      expect(draftsGet).not.toHaveBeenCalled();
      expect(draftsUpdate).toHaveBeenCalledTimes(1);
    } finally {
      // updateDraft deletes staged files in its own finally; this is belt and braces.
      await rm(staged, { force: true });
    }
  });
});

/**
 * `undefined` files vs an empty ARRAY.
 *
 * Multer hands the controller `[]` for a text-only save and for "the user removed
 * every attachment" alike, so the client states which with `setAttachments`. Getting
 * this wrong is silent in both directions: one keeps a file the user deleted, the
 * other deletes files they never touched.
 */
describe('updateDraft — leaving attachments alone vs replacing them', () => {
  const COMPANY = 9;
  const DRAFT = 'r-xyz';

  let svc: GmailService;
  let draftsGet: jest.Mock;
  let draftsUpdate: jest.Mock;
  let attachmentsGet: jest.Mock;

  beforeEach(() => {
    draftsGet = jest.fn(() =>
      Promise.resolve({
        data: {
          id: DRAFT,
          message: {
            id: 'm-xyz',
            threadId: 't-xyz',
            payload: {
              headers: [{ name: 'To', value: 'a@b.com' }],
              parts: [
                {
                  filename: 'report.pdf',
                  mimeType: 'application/pdf',
                  body: { attachmentId: 'att-1', size: 4 },
                  headers: [
                    {
                      name: 'Content-Disposition',
                      value: 'attachment; filename="report.pdf"',
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    );
    draftsUpdate = jest.fn(() =>
      Promise.resolve({ data: { id: DRAFT, message: { id: 'm-xyz' } } }),
    );
    attachmentsGet = jest.fn(() =>
      Promise.resolve({
        data: { data: Buffer.from('pdf!').toString('base64url') },
      }),
    );

    jest.spyOn(google, 'gmail').mockReturnValue({
      users: {
        drafts: { get: draftsGet, update: draftsUpdate },
        messages: { attachments: { get: attachmentsGet } },
      },
    } as unknown as ReturnType<typeof google.gmail>);

    svc = new GmailService(
      {
        gmailAccount: {
          findUnique: () =>
            Promise.resolve({ scope: '', gmailAddress: 'us@cygfinance.com' }),
        },
      } as unknown as PrismaService,
      {
        getForwards: () => Promise.resolve([]),
      } as unknown as MessageStateService,
    );

    (
      svc as unknown as { ensureFreshTokens: () => Promise<unknown> }
    ).ensureFreshTokens = jest.fn().mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  /** The attachment part is re-downloaded, which is how it survives the rewrite. */
  it('carries existing attachments through a text-only save', async () => {
    await svc.updateDraft(COMPANY, DRAFT, { subject: 'still here' });
    expect(attachmentsGet).toHaveBeenCalledTimes(1);
    expect(draftsUpdate).toHaveBeenCalledTimes(1);
  });

  /**
   * The dangerous direction: an explicit empty set means the user removed the last
   * attachment, and the draft must come back without it — NOT with it carried over.
   */
  it('removes every attachment when handed an explicit empty set', async () => {
    await svc.updateDraft(COMPANY, DRAFT, { subject: 'gone' }, []);
    expect(attachmentsGet).not.toHaveBeenCalled();
    expect(draftsUpdate).toHaveBeenCalledTimes(1);
  });

  // The other direction: a supplied set replaces, and nothing is re-downloaded.
  it('replaces the set when handed files, without re-reading the old ones', async () => {
    const staged = path.join(os.tmpdir(), `cyg-draft-set-${Date.now()}.txt`);
    await writeFile(staged, 'x');
    try {
      await svc.updateDraft(COMPANY, DRAFT, { subject: 'new file' }, [
        {
          originalname: 'new.txt',
          mimetype: 'text/plain',
          size: 1,
          path: staged,
        },
      ]);
      expect(attachmentsGet).not.toHaveBeenCalled();
      expect(draftsUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await rm(staged, { force: true });
    }
  });
});
