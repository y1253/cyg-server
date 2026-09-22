/**
 * Parsing the two-length summary block `AiService.summarizeCallStructured` asks for.
 *
 * Kept beside the PROMPT rather than beside its consumer in the phone module, because the
 * two are one contract: change the format the prompt asks for and this has to change in
 * the same breath. It also keeps the dependency pointing the right way — PhoneModule
 * imports AiModule, never the reverse.
 */

// `SHORT:` / `SUMMARY:` at the start of a line, tolerating the markdown bold a model
// drifts into. The TRAILING `\*{0,2}` is not decoration: models write both `**Short**:`
// and `**Short:**`, so the colon falls on either side of the asterisks, and allowing only
// one of the two lets half the bold replies through with a literal `**` still attached.
const SHORT_LABEL = /^[ \t]*\*{0,2}short\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/im;
const SUMMARY_LABEL =
  /^[ \t]*\*{0,2}summary\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/im;

/**
 * How long a one-line summary may be.
 *
 * Enforced by the WRITER, not by CSS. "Not longer than one horizontal line" is a length
 * models routinely overshoot, and the inbox row it has to share already carries a name,
 * a direction and a time — so a `truncate` class alone would hide the overflow behind an
 * ellipsis on every row, at every width, permanently.
 */
export const SHORT_SUMMARY_MAX_CHARS = 120;

/** Flatten to one line and clip, preferring a word boundary when one is close enough. */
export function clipToLine(
  text: string,
  max = SHORT_SUMMARY_MAX_CHARS,
): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  // Only prefer the word boundary when it is not throwing away most of the line.
  const body = space > max * 0.6 ? cut.slice(0, space) : cut;
  return body.replace(/[\s,;:.]+$/, '') + '…';
}

/** The first sentence of a block — the fallback one-liner when the model gave none. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
}

/**
 * Split a `SHORT:` / `SUMMARY:` reply into its two parts.
 *
 * ⚠️ NEVER THROWS, and never returns an empty brief for a non-empty reply. That is the
 * entire reason the format is a line-delimited block rather than JSON: by the time this
 * runs, the call has already been transcribed AND summarised, both billed. Losing that to
 * a missing label would be expensive and completely invisible.
 *
 * The degradation ladder, in order:
 *  - both labels present     → use both;
 *  - SUMMARY missing         → whatever followed SHORT is the brief;
 *  - SHORT missing           → the whole reply is the brief, and the one-liner is derived
 *                              from its first sentence;
 *  - SHORT present but empty → the same derivation, from the brief we did get.
 */
export function parseSummaryReply(raw: string): {
  short: string;
  brief: string;
} {
  const text = (raw ?? '').trim();
  if (!text) return { short: '', brief: '' };

  const shortAt = text.search(SHORT_LABEL);
  const summaryAt = text.search(SUMMARY_LABEL);

  /**
   * The text belonging to the label at `at`, stopping at the other label when that one
   * comes LATER.
   *
   * That conditional is what makes label order irrelevant: a model that answers SUMMARY
   * first would otherwise have its whole SHORT line swallowed into the brief, and the row
   * would then show a duplicate of the summary's own first sentence.
   */
  const body = (
    at: number,
    label: RegExp,
    otherAt: number,
    otherLabel: RegExp,
  ): string => {
    const m = label.exec(text.slice(at));
    const tail = m ? text.slice(at + m[0].length) : text.slice(at);
    if (otherAt > at) {
      const stop = tail.search(otherLabel);
      if (stop !== -1) return tail.slice(0, stop).trim();
    }
    return tail.trim();
  };

  let short = '';
  let brief = '';

  if (summaryAt !== -1) {
    brief = body(summaryAt, SUMMARY_LABEL, shortAt, SHORT_LABEL);
  }

  if (shortAt !== -1) {
    short = body(shortAt, SHORT_LABEL, summaryAt, SUMMARY_LABEL);
    if (summaryAt === -1) {
      // No SUMMARY label at all: everything under SHORT is really the brief.
      brief = short;
      short = '';
    }
  }

  if (!brief) brief = text;
  if (!short) short = firstSentence(brief);

  return { short: clipToLine(short), brief };
}
