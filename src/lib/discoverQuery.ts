import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ContentType, SelectedSegment, Transcript } from "@/lib/database.types";

const matchSchema = z.object({
  index: z.number().int().nonnegative(),
  reason: z.string().min(1).max(160),
});
const responseSchema = z.object({ matches: z.array(matchSchema) });

// This call serves an interactive HTTP request, unlike explainSegments.ts's
// background worker call — the SDK's 10-minute default timeout would leave
// a user staring at a spinner far longer than a "fast, chat-like" query
// should ever take, so it's overridden down to a short, user-facing bound.
const QUERY_TIMEOUT_MS = 18_000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, timeout: QUERY_TIMEOUT_MS });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

function transcriptExcerptFor(segment: SelectedSegment, transcript: Transcript | null): string {
  if (!transcript) return "";
  return transcript.words
    .filter((w) => w.start / 1000 >= segment.start_time && w.end / 1000 <= segment.end_time + 1)
    .map((w) => w.text)
    .join(" ");
}

function buildPrompt(query: string, contentType: ContentType, segments: SelectedSegment[], transcript: Transcript | null): string {
  const instructions = `A creator is looking at a list of short-form video moments and described what they want in their own words. Pick which of the moments below best match their request, ranked best first. Only select moments that genuinely match — if nothing matches, return an empty list rather than forcing a weak match. Select as many or as few as genuinely fit; you may select all of them or none.
For each match, write one short, concrete, user-facing reason (max ~20 words) grounded in that specific moment's own content — not generic filler, and never mention "AI," confidence scores, or your own reasoning process.
Return ONLY valid JSON matching this shape, nothing else:
{"matches":[{"index":number,"reason":string}]}

Creator's request: "${query}"`;

  const momentsText = segments
    .map((s, i) => {
      const excerpt = contentType === "spoken" ? transcriptExcerptFor(s, transcript) : "";
      const duration = Math.round(s.end_time - s.start_time);
      return `[${i}] hook_type=${s.hook_type} caption="${s.suggested_caption}" duration=${duration}s${excerpt ? ` transcript="${excerpt}"` : ""}`;
    })
    .join("\n");

  return `${instructions}\n\nMOMENTS:\n${momentsText}`;
}

export type DiscoverQueryResult =
  | { ok: true; matches: { index: number; reason: string }[] }
  | { ok: false; error: string };

/**
 * Re-ranks/filters the job's already-discovered segments against a
 * free-text request — never discovers new moments, never changes
 * timestamps, only ever returns indices that already exist in `segments`
 * (enforced by the filter below, on top of the prompt instruction). Honest
 * failure on API/parse error: no fallback-to-everything, since this is an
 * optional layer over an already-successful discovery, not a pipeline step
 * that must produce something.
 */
export async function runDiscoverQuery(
  query: string,
  contentType: ContentType,
  segments: SelectedSegment[],
  transcript: Transcript | null,
): Promise<DiscoverQueryResult> {
  const prompt = buildPrompt(query, contentType, segments, transcript);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) continue;

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = responseSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) continue;

      const valid = parsed.data.matches.filter((m) => m.index < segments.length);
      return { ok: true, matches: valid };
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
      const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
      console.error(`[discoverQuery] Anthropic call failed (attempt ${attempt + 1}, status ${status ?? "n/a"}):`, err instanceof Error ? err.message : err, cause ? { cause } : "");
      // fall through to retry, then to the honest failure below
    }
  }

  return { ok: false, error: "Velora couldn't process that request — try rephrasing, or select moments manually." };
}
