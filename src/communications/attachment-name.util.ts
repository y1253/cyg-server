/**
 * RFC 2231 filename parameters, shared by the outgoing MIME builder and the
 * attachment download routes.
 *
 * Both need the same thing for the same reason: neither a MIME parameter nor an
 * HTTP header can carry a non-ASCII filename directly. A Hebrew screenshot name
 * written straight into `Content-Disposition` makes Node's `setHeader` throw
 * `ERR_INVALID_CHAR` -- header values are Latin-1 -- which surfaced as a 500 on
 * every attempt to open or download the file.
 *
 * Lives here rather than in `gmail/` because all three download paths (Gmail,
 * Microsoft, internal messages) need it, and `communications/` is the layer they
 * share; `gmail/` already depends on this directory, not the other way round.
 */

const isAscii = (s: string): boolean => {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s);
};

/**
 * Drop unpaired surrogates.
 *
 * The download path caps filenames at 255 characters, and that slice can land
 * between the two halves of an emoji. `encodeURIComponent` throws `URIError` on
 * a lone surrogate, which would replace the bug this module exists to fix with
 * an identical-looking one.
 */
function dropLoneSurrogates(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/**
 * Builds the filename parameters for an attachment part.
 *
 * RFC 2047 encoded-words are not valid inside MIME parameters, so a non-ASCII
 * filename uses RFC 2231's `filename*=UTF-8''<percent-encoded>` alongside an
 * ASCII `filename="..."` fallback for clients that ignore `filename*`. This is
 * what Gmail emits. The fallback keeps the original extension so the file still
 * opens with the right application.
 */
export function attachmentNameParams(filename: string): {
  asciiName: string;
  filenameParam: string;
} {
  // Quotes/backslashes/CRLF would break out of the quoted-string parameter.
  const clean = dropLoneSurrogates(
    (filename || 'attachment').replace(/["\r\n\\]/g, '_'),
  );

  if (isAscii(clean)) {
    return { asciiName: clean || 'attachment', filenameParam: '' };
  }

  const ext = /(\.[A-Za-z0-9]{1,8})$/.exec(clean)?.[1] ?? '';
  return {
    asciiName: `attachment${ext}`,
    filenameParam: `; filename*=UTF-8''${encodeURIComponent(clean)}`,
  };
}
