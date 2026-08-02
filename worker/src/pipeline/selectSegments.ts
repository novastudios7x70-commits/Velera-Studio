import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../lib/env.js";
import type { AudioAnalysis, ContentType, SelectedSegment, Transcript } from "../lib/database.types.js";

const segmentSchema = z.object({
  start_time: z.number().nonnegative(),
  end_time: z.number().positive(),
  hook_type: z.enum([
    "surprising_claim",
    "question",
    "contrarian",
    "result_number",
    "emotional",
    "chorus",
    "bridge",
  ]),
  suggested_caption: z.string().min(1).max(140),
  confidence: z.number().int().min(0).max(100),
});

const responseSchema = z.object({ segments: z.array(segmentSchema).min(1).max(5) });

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export const MIN_CLIP_SECONDS = 12;
const MAX_CLIP_SECONDS = 45;

function buildPrompt(contentType: ContentType, transcript: Transcript | null, audioAnalysis: AudioAnalysis | null) {
  const instructions = `You select the 3-5 best short-form-video moments from the source below.
Return ONLY valid JSON matching this shape, nothing else:
{"segments":[{"start_time":number,"end_time":number,"hook_type":"surprising_claim"|"question"|"contrarian"|"result_number"|"emotional"|"chorus"|"bridge","suggested_caption":string,"confidence":0-100}]}

Rules:
- Each segment must be self-contained and make sense with no other context.
- Clip length must be between ${MIN_CLIP_SECONDS} and ${MAX_CLIP_SECONDS} seconds.
- Prefer moments with a strong opening line/beat within the first 2 seconds (the "hook").
- suggested_caption is a short, punchy on-screen caption a creator would post with the clip — not a summary.
- confidence reflects how likely this specific moment is to stop a scroll, 0-100.
- Order segments by confidence, descending.
- For music, only use hook_type "chorus" or "bridge". For spoken content, use the other five types.`;

  if (contentType === "spoken" && transcript) {
    const transcriptText = transcript.words
      .map((w) => `[${(w.start / 1000).toFixed(1)}s] ${w.text}`)
      .join(" ");
    return `${instructions}\n\nTRANSCRIPT (word start times in seconds):\n${transcriptText}`;
  }

  const windows = audioAnalysis?.windows ?? [];
  const windowsText = windows
    .map((w) => `[${w.start.toFixed(1)}s-${w.end.toFixed(1)}s] energy=${w.energy.toFixed(2)} label=${w.label}`)
    .join("\n");
  return `${instructions}\n\nAUDIO ENERGY WINDOWS (music track, no lyrics transcript provided):\n${windowsText}`;
}

/**
 * Deterministic fallback used when the LLM call fails outright or returns
 * something we can't parse after a retry — keeps a job moving instead of
 * failing it outright over a flaky/malformed model response.
 */
function heuristicFallback(contentType: ContentType, transcript: Transcript | null, audioAnalysis: AudioAnalysis | null): SelectedSegment[] {
  if (contentType === "music" && audioAnalysis) {
    return [...audioAnalysis.windows]
      .sort((a, b) => b.energy - a.energy)
      .slice(0, 4)
      .map((w) => ({
        start_time: w.start,
        end_time: Math.min(w.end + 15, w.start + MAX_CLIP_SECONDS),
        hook_type: w.label === "chorus" ? "chorus" : "bridge",
        suggested_caption: "the part everyone's gonna clip",
        confidence: Math.round(60 + w.energy * 30),
      }));
  }

  if (transcript && transcript.words.length > 0) {
    const totalMs = transcript.words[transcript.words.length - 1].end;
    const segments: SelectedSegment[] = [];
    const chunkCount = 3;
    for (let i = 0; i < chunkCount; i++) {
      const startMs = (totalMs / chunkCount) * i;
      const endMs = Math.min(startMs + 25000, totalMs);
      segments.push({
        start_time: startMs / 1000,
        end_time: endMs / 1000,
        hook_type: "result_number",
        suggested_caption: "worth the watch",
        confidence: 55,
      });
    }
    return segments;
  }

  return [];
}

export async function selectSegments(
  contentType: ContentType,
  transcript: Transcript | null,
  audioAnalysis: AudioAnalysis | null,
): Promise<SelectedSegment[]> {
  const prompt = buildPrompt(contentType, transcript, audioAnalysis);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: env.anthropicModel,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) continue;

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = responseSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) continue;

      const valid = parsed.data.segments.filter((s) => s.end_time > s.start_time);
      if (valid.length > 0) return valid;
    } catch {
      // fall through to retry, then to the heuristic fallback below
    }
  }

  return heuristicFallback(contentType, transcript, audioAnalysis);
}
