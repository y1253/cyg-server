import { BadRequestException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { google, type drive_v3 } from 'googleapis';
import type { SharedLink } from '../communications/link-attachments.util.js';

// ─── Drive hosting for oversized email attachments ───────────────────────────
// When a file is too big to ride inside the message, Gmail itself uploads it to
// the sender's Drive and links it. This does the same thing through the API.
//
// Scope is `drive.file` — the app can only ever see files IT created, never the
// rest of the user's Drive. That also means `files.list` below returns only our
// own folder, which is why the find-or-create query is safe and cheap.

/** The folder every linked attachment is filed under, in the sender's own Drive. */
const FOLDER_NAME = 'Cyg Finance attachments';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Whether the connected mailbox actually granted the Drive scope. Accounts that
 * connected before it was added won't have it — Google does not retroactively
 * widen an existing token — so callers must guide the user to reconnect rather
 * than fail with an opaque 403.
 */
export function grantsDriveUpload(scope: string | null | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(DRIVE_SCOPE);
}

// Taken off the client options rather than imported from google-auth-library:
// googleapis-common carries its OWN nested copy of that package, and the two
// OAuth2Client declarations are structurally incompatible (private fields).
type DriveAuth = NonNullable<drive_v3.Options['auth']>;

export function makeDriveClient(auth: DriveAuth): drive_v3.Drive {
  return google.drive({ version: 'v3', auth });
}

/** Find-or-create the attachments folder; returns its file id. */
async function ensureAttachmentFolder(drive: drive_v3.Drive): Promise<string> {
  const existing = await drive.files.list({
    q:
      `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and ` +
      "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id)',
    pageSize: 1,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  const id = created.data.id;
  if (!id)
    throw new BadRequestException(
      'Google Drive did not return a folder for the attachment. Please try ' +
        'sending again.',
    );
  return id;
}

/**
 * Upload one staged file and return a share link.
 *
 * `media.body` is a read stream, so googleapis uses a resumable upload and the
 * bytes never sit in this process's memory — which is the whole point at a 250 MB
 * cap. The permission is `anyone`/`reader` (view-only, link-holders), matching
 * what Gmail grants when you accept its "share with recipients" prompt; recipients
 * outside Google would otherwise hit a sign-in wall.
 */
export async function uploadAndShare(
  drive: drive_v3.Drive,
  folderId: string,
  file: { originalname: string; mimetype: string; size: number; path: string },
): Promise<SharedLink> {
  const created = await drive.files.create({
    requestBody: {
      name: file.originalname,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype || 'application/octet-stream',
      body: createReadStream(file.path),
    },
    fields: 'id, webViewLink',
  });

  const fileId = created.data.id;
  if (!fileId)
    throw new BadRequestException(
      `Google Drive did not return a file id for "${file.originalname}". The ` +
        'upload did not complete — please try sending again.',
    );

  // Link-holder sharing, falling back to domain-only — the same two-step
  // `onedrive-upload.ts` already does, and for the same reason: a Workspace policy
  // can forbid sharing outside the organisation, which 403s the `anyone` grant.
  // Without a fallback that 403 propagated as a bare Error and the user was told
  // "Internal server error" for a file that had already uploaded successfully.
  //
  // `domain` is a real degradation — an external recipient hits a sign-in wall — so
  // it is a last resort before failing, not a silent equivalent.
  let shared = false;
  let lastShareError: unknown;
  for (const type of ['anyone', 'domain'] as const) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type },
      });
      shared = true;
      break;
    } catch (err) {
      lastShareError = err;
    }
  }
  if (!shared) {
    throw new BadRequestException(
      `Google Drive refused to share "${file.originalname}" ` +
        `(${lastShareError instanceof Error ? lastShareError.message : String(lastShareError)}). ` +
        'Your Google Workspace may block link sharing — send the file another way, ' +
        'or ask an administrator to allow it.',
    );
  }

  // webViewLink is populated on create, but re-read it if the field came back
  // empty (it is omitted until the file is fully committed on some accounts).
  let url = created.data.webViewLink ?? '';
  if (!url) {
    const meta = await drive.files.get({ fileId, fields: 'webViewLink' });
    url =
      meta.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
  }

  return { name: file.originalname, size: file.size, url };
}

/**
 * Upload every linked file, sequentially. Sequential rather than parallel on
 * purpose: these are the big ones, and ten concurrent resumable uploads would
 * saturate the server's uplink and make each individually slower.
 */
export async function uploadAllToDrive(
  drive: drive_v3.Drive,
  files: Array<{
    originalname: string;
    mimetype: string;
    size: number;
    path: string;
  }>,
): Promise<SharedLink[]> {
  if (files.length === 0) return [];
  const folderId = await ensureAttachmentFolder(drive);
  const links: SharedLink[] = [];
  for (const f of files) {
    links.push(await uploadAndShare(drive, folderId, f));
  }
  return links;
}
