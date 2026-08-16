import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../lib/env.js";
import type { ContentType, SelectedSegment, Transcript } from "../lib/database.types.js";

const explanationSchema = z.object({
  index: z.number().int().nonnegative(),
  why: z.string().min(1).max(160),
});
const responseSchema = z.object({ explanations: z.array(explanationSchema) });

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

function transcriptExcerptFor(segment: SelectedSegment, transcript: Transcript | null): string {
  if (!transcript) return "";
  return transcript.words
    .filter((w) => w.start / 1000 >= segment.start_time && w.end / 1000 <= segment.end_time + 1)
    .map((w) => w.text)
    .join(" ");
}

function buildPrompt(contentType: ContentType, segments: SelectedSegment[], transcript: Transcript | null): string {
  const instructions = `For each moment below, write one short, concrete, user-facing sentence (max ~20 words) explaining why it was picked as a candidate short-form clip. Ground it in what's actually in the moment — its transcript excerpt or hook type — not generic filler. Never mention "AI," confidence scores, or your own reasoning process; just describe what makes the moment itself work.
Return ONLY valid JSON matching this shape, nothing else:
{"explanations":[{"index":number,"why":string}]}`;

  const momentsText = segments
    .map((s, i) => {
      const excerpt = contentType === "spoken" ? transcriptExcerptFor(s, transcript) : "";
      return `[${i}] hook_type=${s.hook_type} caption="${s.suggested_caption}"${excerpt ? ` transcript="${excerpt}"` : ""}`;
    })
    .join("\n");

  return `${instructions}\n\nMOMENTS:\n${momentsText}`;
}

/**
 * Best-effort per-segment "why this was surfaced" text, grounded in each
 * segment's own transcript excerpt/hook_type — one call for the whole job's
 * discovered segments rather than one call per segment (cheaper, and mirrors
 * selectSegments.ts's single-call shape). Returns a partial/empty map on
 * failure rather than throwing: this is enrichment, not a job requirement —
 * the caller leaves `why` unset on any segment missing from the map, and the
 * frontend's existing static whyForSegment() fallback covers the rest.
 */
export async function explainSegments(
  contentType: ContentType,
  segments: SelectedSegment[],
  transcript: Transcript | null,
): Promise<Map<number, string>> {
  const prompt = buildPrompt(contentType, segments, transcript);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: env.anthropicModel,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) continue;

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = responseSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) continue;

      const result = new Map<number, string>();
      for (const e of parsed.data.explanations) {
        if (e.index < segments.length) result.set(e.index, e.why);
      }
      if (result.size > 0) return result;
    } catch {
      // fall through to retry, then give up — caller treats an empty map
      // the same as any other per-segment fallback case
    }
  }

  return new Map();
}
