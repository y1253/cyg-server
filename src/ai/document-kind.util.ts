/**
 * What kind of thing an attachment is, for summarising.
 *
 * ── THE RULE THIS FOLLOWS ─────────────────────────────────────────────────────
 * An allow-list per kind, corroborated by the filename — never a bare prefix test. This
 * is `whatsappMediaKind`'s rule and `isMmsImage`'s rule, and it exists because the mime
 * type is CLIENT-SUPPLIED: a special-cased kind has to be confirmed by the extension, not
 * merely left uncontradicted by it, or `payload.exe` announced as `image/png` is read as
 * a picture.
 *
 * Unlike those two, an unrecognised type here is REFUSED rather than demoted. They had a
 * `document` fallback because something had to be sent; this has nothing to fall back to
 * — a model cannot read bytes it has no decoder for, and pretending otherwise spends
 * money to produce a confident sentence about nothing.
 */
export type DocumentKind = 'text' | 'pdf' | 'image';

const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'application/json',
]);
const TEXT_EXTS = new Set(['.txt', '.csv', '.md', '.html', '.htm', '.json']);

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Word's pre-2007 binary format. Named explicitly so the refusal can say something useful. */
const LEGACY_DOC_EXTS = new Set(['.doc', '.xls', '.ppt']);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot).toLowerCase() : '';
}

function baseMime(mimetype: string): string {
  return (mimetype || '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * The kind, or a sentence saying why not.
 *
 * ⚠️ The refusal is a SENTENCE THE SENDER CAN ACT ON, not a generic "unsupported". That
 * is the `isMmsImage` posture: refusing `image/heic` up front with a reason beats letting
 * it die inside a decoder and surfacing as something untrue.
 */
export function documentKind(
  mimetype: string,
  filename: string,
): { kind: DocumentKind } | { refuse: string } {
  const mime = baseMime(mimetype);
  const ext = extensionOf(filename);

  if (LEGACY_DOC_EXTS.has(ext)) {
    return {
      refuse:
        'That is an older Office format, which cannot be read here. Save it as a PDF and try again.',
    };
  }

  const claims: [DocumentKind, Set<string>, Set<string>][] = [
    ['text', TEXT_MIMES, TEXT_EXTS],
    ['image', IMAGE_MIMES, IMAGE_EXTS],
  ];
  for (const [kind, mimes, exts] of claims) {
    if (!mimes.has(mime)) continue;
    // No extension at all (a pasted screenshot usually has none) is judged on the
    // declared type alone; a PRESENT extension has to agree.
    if (ext && !exts.has(ext)) break;
    return { kind };
  }

  if (mime === 'application/pdf' && (!ext || ext === '.pdf')) {
    return { kind: 'pdf' };
  }
  // A .pdf name with some other declared type is still a PDF worth trying: browsers and
  // mail clients label them inconsistently, and the decoder either reads it or does not.
  if (ext === '.pdf') return { kind: 'pdf' };

  return {
    refuse:
      'That kind of file cannot be summarised. PDFs, pictures and plain text files can be.',
  };
}

/**
 * The canonical mime for a filename's extension, or `''`.
 *
 * Email attachments arrive as raw bytes plus a name — the provider's own content type is
 * not carried through the fetch — so the extension is all there is to go on. Returning
 * `''` for anything unrecognised is what makes `documentKind` refuse it rather than
 * guess, which is the same posture as everywhere else here.
 */
export function mimeForFilename(filename: string): string {
  const ext = extensionOf(filename);
  const byExt: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.json': 'application/json',
  };
  return byExt[ext] ?? '';
}
