import { env } from "../lib/env.js";

// Mirrors src/app/api/jobs/route.ts's TTS_VOICE_ID_PATTERN — duplicated
// rather than imported (src/ and worker/ never import across their package
// boundary, see CLAUDE.md). voiceId is spliced directly into a URL path
// segment below, so this is a defensive re-check against a crafted value
// (e.g. containing "../") reaching that fetch() call and redirecting it to
// a different ElevenLabs endpoint via path-segment normalization, in case
// this function is ever called with a value that skipped the app-level
// check (a future direct call site, a bug in that check, etc.).
const TTS_VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Text-to-speech source path (Step 1, spoken content only) — instead of an
 * uploaded recording, the source audio is generated from a typed script.
 *
 * Deliberately uses only ElevenLabs' plain, synchronous convert endpoint
 * (confirmed against their own docs/SDK) rather than their timestamped
 * variant: this project burned a lot of time earlier guessing at a less
 * common Higgsfield endpoint shape, so here the generated audio is instead
 * fed through the existing (already-proven) AssemblyAI transcription step
 * to get word timings, exactly like any other spoken upload. One well-known,
 * stable endpoint instead of two guessed ones.
 */
export async function generateVoiceover(text: string, voiceId: string): Promise<Buffer> {
  if (!env.elevenLabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured");
  }
  if (!TTS_VOICE_ID_PATTERN.test(voiceId)) {
    throw new Error("Invalid ElevenLabs voice ID");
  }

  const res = await fetch(`${env.elevenLabsApiUrl}/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs text-to-speech request failed (${res.status}): ${body.slice(0, 500)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
