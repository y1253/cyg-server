/**
 * The backstop against a transcript the model invented rather than heard.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────────
 * Speech-to-text models trained on captioned video answer near-silent, very short or
 * language-ambiguous audio with the boilerplate that ends such a video. Reported here as
 * a two-word dictation — "hi what's doing" — coming back as "Thank you for watching."
 *
 * Moving dictation off `whisper-1` (see `dictationModel`) is the real fix and makes this
 * rare. This is the layer that still holds if the model is ever changed back, or if a
 * future one carries its own variant of the same artefact — which is why it is a separate
 * pure function with its own spec rather than a line inside the controller.
 *
 * ⚠️ Deliberately NOT applied to call summaries, inbound WhatsApp voice notes or the
 * WhatsApp voice-code reader. The first two are already bounded by
 * `isTranscriptUsable`'s 20-character floor, and the third must see the raw string: it is
 * reading six spoken digits off a robocall, where a denylist has nothing to contribute and
 * a false positive would fail a verification attempt that is capped at 10 per 72 hours.
 */

/**
 * Artefacts seen from the Whisper family, in both languages this firm speaks.
 *
 * Stored WITHOUT diacritics and without punctuation, because `normalise` strips both
 * before comparing — so a model that emits `réalisés` and one that emits `realises` are
 * caught by the same entry.
 */
const HALLUCINATIONS = new Set([
  'thank you',
  'thanks',
  'thank you very much',
  'thank you for watching',
  'thanks for watching',
  'thank you for watching this video',
  'thank you for listening',
  'please subscribe',
  'like and subscribe',
  'subtitles by the amara org community',
  'subtitles by',
  'transcription by castingwords',
  'merci',
  'merci beaucoup',
  "merci d'avoir regarde",
  "merci d'avoir regarde cette video",
  "sous titres realises par la communaute d'amara org",
  'sous titres realises par',
  'abonnez vous',
  'you',
  'bye',
  'bye bye',
  'music',
  'musique',
  'applause',
  'silence',
  'blank audio',
  'inaudible',
  // Observed from whisper-1 on a near-silent clip by scripts/dictation-probe.mjs. The
  // bare 'you' is what it answered with no prompt; the domain is a documented artefact of
  // the same training data.
  'www mooji org',
  'mooji org',
]);

/**
 * Lowercase, drop diacritics, unwrap bracketed stage directions such as `[MUSIC]`, and
 * reduce everything that is not a letter, digit or apostrophe to a single space.
 *
 * The apostrophe survives so `merci d'avoir regarde` stays one recognisable token rather
 * than collapsing into something a real sentence could also produce.
 */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[[\](){}<>*_~#]/g, ' ')
    .replace(/[^\p{Letter}\p{Number}']+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Is the WHOLE transcript one known artefact — or nothing at all?
 *
 * ⚠️ Whole-transcript match, NEVER a substring. "Thanks for watching the video I sent"
 * is a sentence somebody will genuinely dictate to a client, and a rule that stripped a
 * phrase found anywhere would delete it silently. Every entry above is short enough that
 * substring matching would fire on ordinary prose.
 *
 * Empty and whitespace-only count as hallucinated so the caller has ONE branch to handle:
 * `transcribeAudio` already treats an empty transcript as silence rather than an error,
 * and `DictateButton` already has the wording for it.
 */
export function isHallucinatedTranscript(text: string): boolean {
  const normalised = normalise(text);
  return normalised === '' || HALLUCINATIONS.has(normalised);
}
