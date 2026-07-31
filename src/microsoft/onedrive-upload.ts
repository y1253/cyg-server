import { graphPost, uploadFileInChunks } from './graph.util.js';
import type { SharedLink } from '../communications/link-attachments.util.js';
import type { OutboundFile } from '../communications/outbound-uploads.js';

// ─── OneDrive hosting for oversized email attachments ────────────────────────
// When a file is too big to ride inside the message, Outlook uploads it to the
// sender's OneDrive and links it. This does the same through Graph: an upload
// session for the bytes, then `createLink` for a view-only sharing URL.

/** The folder every linked attachment is filed under, in the sender's OneDrive. */
const FOLDER_NAME = 'Cyg Finance attachments';

/**
 * Whether the connected mailbox actually granted a OneDrive write scope. Graph
 * hands back fully-qualified scope URIs (`https://graph.microsoft.com/Files.ReadWrite`)
 * for work accounts and bare names for some personal ones, so match on the tail.
 */
export function grantsOneDriveUpload(
  scope: string | null | undefined,
): boolean {
  return (scope ?? '')
    .split(/\s+/)
    .map((s) => s.toLowerCase().split('/').pop() ?? '')
    .some((s) => s === 'files.readwrite' || s === 'files.readwrite.all');
}

/** `folder/name.ext` with each segment percent-encoded for the `root:/…:` addressing form. */
function drivePath(filename: string): string {
  return [FOLDER_NAME, filename]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface DriveItem {
  id?: string;
  webUrl?: string;
}

async function uploadAndShare(
  token: string,
  file: OutboundFile,
): Promise<SharedLink> {
  const session = await graphPost<{ uploadUrl?: string }>(
    token,
    `/me/drive/root:/${drivePath(file.originalname)}:/createUploadSession`,
    // `rename` rather than `replace`: sending the same filename twice must not
    // silently repoint an earlier recipient's link at the newer file.
    { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
  );
  const uploadUrl = session?.uploadUrl;
  if (!uploadUrl) {
    throw new Error(
      `OneDrive returned no uploadUrl for "${file.originalname}"`,
    );
  }

  const item = await uploadFileInChunks<DriveItem>(
    uploadUrl,
    file.path,
    file.size,
    file.originalname,
  );
  const itemId = item?.id;
  if (!itemId) {
    throw new Error(`OneDrive returned no item id for "${file.originalname}"`);
  }

  // Anonymous view link so recipients outside the tenant can open it — the same
  // thing Outlook's "Anyone with the link" default produces. Many tenants forbid
  // anonymous sharing by policy; fall back to an org-wide link rather than
  // failing the whole send, and let the last error surface if both are blocked.
  let url: string | undefined;
  for (const shareScope of ['anonymous', 'organization'] as const) {
    try {
      const link = await graphPost<{ link?: { webUrl?: string } }>(
        token,
        `/me/drive/items/${itemId}/createLink`,
        { type: 'view', scope: shareScope },
      );
      url = link?.link?.webUrl;
      if (url) break;
    } catch (err) {
      if (shareScope === 'organization') {
        throw new Error(
          `OneDrive refused to create a sharing link for "${file.originalname}" ` +
            `(${err instanceof Error ? err.message : String(err)}). Your ` +
            'Microsoft 365 tenant may block link sharing.',
        );
      }
    }
  }
  if (!url) {
    // No link, but the file did upload — fall back to its item URL so the
    // recipient at least has something the sender can grant access to.
    url = item.webUrl ?? '';
    if (!url) {
      throw new Error(
        `OneDrive returned no sharing URL for "${file.originalname}"`,
      );
    }
  }

  return { name: file.originalname, size: file.size, url };
}

/**
 * Upload every linked file, sequentially — these are the big ones, and ten
 * concurrent chunked uploads would just contend for the same uplink.
 */
export async function uploadAllToOneDrive(
  token: string,
  files: OutboundFile[],
): Promise<SharedLink[]> {
  const links: SharedLink[] = [];
  for (const f of files) {
    links.push(await uploadAndShare(token, f));
  }
  return links;
}
