/**
 * What does the transcription endpoint answer when there is nothing to hear?
 *
 * ── WHY THIS SCRIPT EXISTS ────────────────────────────────────────────────────
 * Dictation was reported transcribing "hi what's doing" as "Thank you for watching" —
 * `whisper-1` reaching for the boilerplate that ends a captioned video. Fixing that meant
 * choosing a model and deciding whether to send a steering `prompt`, and the four
 * combinations cannot be reasoned about: they have to be measured. This is that
 * measurement, and it is the evidence behind `dictationModel` and behind the deliberate
 * absence of a `prompt` field on `transcribeAudio`.
 *
 * Result on a 1.2s near-silent clip, Sep 2026:
 *
 *   gpt-4o-mini-transcribe, no prompt   ""                  <- shipped
 *   gpt-4o-mini-transcribe, prompt      the prompt, echoed back verbatim
 *   whisper-1,              no prompt   "you"
 *   whisper-1,              prompt      "www.mooji.org"
 *
 * All four transcribed real speech correctly, so silence is the only thing that separates
 * them — and the echo is the worst outcome available, since it would paste our own
 * steering text into the box the user is about to send from.
 *
 * Costs a fraction of a cent per clip. Usage, from server/:
 *   node --env-file=.env scripts/dictation-probe.mjs <clip.mp3> [more.mp3 ...]
 *
 * Generate the two clips it wants with the bundled ffmpeg:
 *   near-silence:  ffmpeg -f lavfi -i "anoisesrc=d=1.2:c=pink:a=0.002" -ac 1 -ar 16000 quiet.mp3
 *   real speech:   record one, or synthesize with the OS text-to-speech
 *
 * ⚠️ Sets NODE_TLS_REJECT_UNAUTHORIZED like main.ts does, or the office TLS proxy fails
 * every request with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('OPENAI_API_KEY is not set. Run with --env-file=.env');
  process.exit(1);
}

const URL_ = 'https://api.openai.com/v1/audio/transcriptions';

/** A plausible steering prompt — the one this change nearly shipped. */
const PROMPT =
  'Dictated notes and message drafts at a Montreal bookkeeping and accountancy firm. ' +
  'English and French, sometimes mixed within one sentence.';

const SHAPES = [
  { label: 'mini,    no prompt  <- shipped', model: 'gpt-4o-mini-transcribe' },
  { label: 'mini,    prompt', model: 'gpt-4o-mini-transcribe', prompt: PROMPT },
  { label: 'whisper, no prompt', model: 'whisper-1' },
  { label: 'whisper, prompt', model: 'whisper-1', prompt: PROMPT },
];

async function transcribe(bytes, filename, shape) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), filename);
  form.append('model', shape.model);
  form.append('response_format', 'json');
  if (shape.prompt !== undefined) form.append('prompt', shape.prompt);
  form.append('temperature', '0');

  const started = Date.now();
  let res;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      body: form,
    });
  } catch (err) {
    return { ms: Date.now() - started, error: err.message };
  }
  const ms = Date.now() - started;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ms, error: data.error?.message ?? `HTTP ${res.status}` };
  return { ms, text: (data.text ?? '').trim() };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Pass at least one audio file. See the header for how to make one.');
  process.exit(1);
}

for (const file of files) {
  const bytes = await readFile(file);
  console.log(`\n=== ${basename(file)} (${bytes.length} bytes) ===`);
  for (const shape of SHAPES) {
    const r = await transcribe(bytes, basename(file), shape);
    const answer = r.error
      ? `ERROR ${r.error}`
      : JSON.stringify(r.text.slice(0, 100));
    console.log(
      `  ${shape.label.padEnd(32)} ${String(r.ms).padStart(5)}ms  ${answer}`,
    );
  }
}
console.log(
  '\nA prompt echoed back as the transcript is the failure this probe exists to catch.\n',
);
