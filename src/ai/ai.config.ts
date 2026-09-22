/**
 * Pure config readers for the AI assistance features, in the shape `phone.config.ts` set:
 * a function per value, taking `env` rather than reading `process.env`, so every one is
 * testable and none of them can drift from what the spec asserts.
 */

/**
 * The master switch for assistance — dictation, translation and document summaries.
 *
 * ⚠️ DEFAULT OFF, and only the literal `'1'` turns it on. This follows
 * `PHONE_SUMMARIZE_CALLS`, not `PHONE_RECORD_CALLS`, and the difference between those two
 * is the rule: default-ON is for things whose data stays on our own infrastructure and
 * whose decision is storage and consent; default-OFF is for things that bill per unit AND
 * send a client's content to a third party. Everything here does both.
 *
 * It is also the rollback: one variable, no deploy.
 */
export function aiAssist(env: Record<string, string | undefined>): boolean {
  return (env.AI_ASSIST ?? '').trim() === '1';
}

/**
 * Transcribing voice notes a CLIENT sent us — a second switch, on purpose.
 *
 * This is the one capability that creates a stored, verbatim record of a client's spoken
 * words in our own database, which is exactly the decision `CallSummary.transcript`
 * carries a warning about. Turning on dictation and translation must not silently opt the
 * firm into that too, so it has its own flag and its own default.
 */
export function aiTranscribeInbound(
  env: Record<string, string | undefined>,
): boolean {
  return (env.AI_TRANSCRIBE_INBOUND ?? '').trim() === '1';
}

/**
 * The model that reads documents and images.
 *
 * The same fallback ladder `summaryModel` uses, with one more rung: an operator who has
 * already pinned a model for summaries or for polish does not have to pin it a third
 * time. The default is already vision-capable, so the variable is an escape hatch rather
 * than something anybody has to set.
 */
export function visionModel(env: Record<string, string | undefined>): string {
  for (const candidate of [
    env.OPENAI_VISION_MODEL,
    env.OPENAI_SUMMARY_MODEL,
    env.OPENAI_POLISH_MODEL,
  ]) {
    const raw = (candidate ?? '').trim();
    if (raw !== '') return raw;
  }
  return 'gpt-4o-mini';
}

/**
 * The chat model for translation.
 *
 * Deliberately the same ladder as `summaryModel` without its own variable: translating a
 * message and summarising a call are both "read this and write English", and adding a
 * third env var for a knob nobody is asking to turn separately is clutter. Pinning
 * `OPENAI_SUMMARY_MODEL` or `OPENAI_POLISH_MODEL` moves both.
 */
export function summaryOrPolishModel(
  env: Record<string, string | undefined>,
): string {
  for (const candidate of [env.OPENAI_SUMMARY_MODEL, env.OPENAI_POLISH_MODEL]) {
    const raw = (candidate ?? '').trim();
    if (raw !== '') return raw;
  }
  return 'gpt-4o-mini';
}
