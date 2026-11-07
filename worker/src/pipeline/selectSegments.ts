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

// How much of the SHORTER of two candidates' own duration may be covered
// by the other before they're considered "the same moment" rather than two
// distinct ones. Deliberately relative to the shorter segment, not to
// intersection/union (IoU): clips here legitimately range from 12s to 45s,
// and IoU under-penalizes a short clip nearly swallowed by a much longer
// one (union grows with the longer clip, diluting the ratio) — exactly the
// failure mode a production run exposed. 0.4 is a tunable starting point,
// validated against that run's real numbers (its two genuinely-overlapping
// pairs came out to ~0.46 and ~0.50 against this metric; a legitimate
// adjacent-but-distinct pair sharing only a couple of boundary seconds on
// a 20s clip comes out to ~0.1) rather than a derived constant — treat it
// as a product/tuning knob, not a law.
export const OVERLAP_RATIO_THRESHOLD = 0.4;

function buildPrompt(contentType: ContentType, transcript: Transcript | null, audioAnalysis: AudioAnalysis | null, maxEndSeconds: number) {
  const instructions = `You select the 3-5 best short-form-video moments from the source below.
Return ONLY valid JSON matching this shape, nothing else:
{"segments":[{"start_time":number,"end_time":number,"hook_type":"surprising_claim"|"question"|"contrarian"|"result_number"|"emotional"|"chorus"|"bridge","suggested_caption":string,"confidence":0-100}]}

Rules:
- The source is only ${maxEndSeconds.toFixed(1)} seconds long — every segment's end_time must be <= ${maxEndSeconds.toFixed(1)}. Do not propose anything past that.
- Each segment must be self-contained and make sense with no other context.
- Clip length must be between ${MIN_CLIP_SECONDS} and ${Math.min(MAX_CLIP_SECONDS, maxEndSeconds)} seconds.
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
function heuristicFallback(
  contentType: ContentType,
  transcript: Transcript | null,
  audioAnalysis: AudioAnalysis | null,
  maxEndSeconds: number,
): SelectedSegment[] {
  if (contentType === "music" && audioAnalysis) {
    return [...audioAnalysis.windows]
      .sort((a, b) => b.energy - a.energy)
      .slice(0, 4)
      .map((w) => {
        // The naive w.end + 15 extension assumes a full-length track; on a
        // short/scoped window that routinely overshoots the actual
        // available audio, so every segment was getting cut in the
        // post-filter step. Clamp to what's really there, then slide the
        // start back (not just shrink the end) to try to still hit
        // MIN_CLIP_SECONDS where the window allows it.
        const end = Math.min(w.end + 15, w.start + MAX_CLIP_SECONDS, maxEndSeconds);
        const start = Math.max(0, Math.min(w.start, end - MIN_CLIP_SECONDS));
        return {
          start_time: start,
          end_time: end,
          hook_type: (w.label === "chorus" ? "chorus" : "bridge") as SelectedSegment["hook_type"],
          suggested_caption: "the part everyone's gonna clip",
          confidence: Math.round(60 + w.energy * 30),
        };
      })
      .filter((s) => s.end_time - s.start_time >= 1);
  }

  if (transcript && transcript.words.length > 0) {
    const totalMs = Math.min(transcript.words[transcript.words.length - 1].end, maxEndSeconds * 1000);
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
    return segments.filter((s) => s.end_time - s.start_time >= 1);
  }

  return [];
}

// intersection_duration / min(duration_a, duration_b) — see
// OVERLAP_RATIO_THRESHOLD's own comment for why this and not IoU. Returns 0
// (never divides by zero) for a degenerate zero/negative-duration input;
// dedupeOverlappingSegments below filters those out before this is ever
// called, but this function doesn't rely on that — it's safe on its own.
function overlapRatio(a: SelectedSegment, b: SelectedSegment): number {
  const intersectionStart = Math.max(a.start_time, b.start_time);
  const intersectionEnd = Math.min(a.end_time, b.end_time);
  const intersection = Math.max(0, intersectionEnd - intersectionStart);
  const shorterDuration = Math.min(a.end_time - a.start_time, b.end_time - b.start_time);
  if (shorterDuration <= 0) return 0;
  return intersection / shorterDuration;
}

/**
 * Removes candidates that cover substantially the same moment as another
 * candidate, guaranteeing that no two segments in the returned array have
 * an overlapRatio() >= OVERLAP_RATIO_THRESHOLD against each other.
 *
 * Strategy — greedy acceptance in a fixed preference order, never a
 * scan-and-replace:
 *
 * 1. Drop structurally invalid input first: a non-finite start_time or
 *    end_time (NaN, Infinity, -Infinity), or end_time <= start_time. Every
 *    known caller (the LLM path's own schema+filter, both
 *    heuristicFallback branches, and the synthetic whole-window segment in
 *    jobRunner.ts) already guarantees finite, positive duration, but this
 *    function doesn't trust that — it must never divide by zero or let a
 *    non-finite value reach the arithmetic below. `end_time > start_time`
 *    alone would incidentally reject NaN too (any comparison against NaN
 *    is false), but it does NOT reject a single infinite bound paired with
 *    a finite one (e.g. end_time: Infinity, start_time: 5 — Infinity > 5
 *    is true) — that case would otherwise survive into duration math as
 *    Infinity, and a later Infinity - Infinity in the sort comparator
 *    produces NaN, which makes Array.sort's ordering unspecified. The
 *    explicit Number.isFinite() checks close that gap directly instead of
 *    relying on incidental NaN-comparison behavior.
 *
 * 2. Sort the survivors into ONE deterministic preference order that fully
 *    decides, in advance, who wins any conflict — longer duration first
 *    (the primary retention preference: a longer segment captures more of
 *    whatever moment is shared, which is the only objective, trustworthy
 *    signal available here; duration is always finite by this point, since
 *    step 1 already guaranteed finite start_time/end_time on every
 *    survivor), then higher confidence ONLY to break an exact duration tie
 *    (confidence is an unverified, LLM-self-reported number — see the
 *    production audit — so it must never be the primary or sole reason a
 *    candidate is discarded) — and confidence is explicitly guarded here
 *    too: it's read straight off whatever selectSegments()/heuristicFallback
 *    produced, with no schema re-validation at this layer, so a missing or
 *    non-finite value on either side is treated as "no usable confidence
 *    signal" and falls through to the next tiebreaker rather than
 *    participating in subtraction, which would otherwise poison the
 *    comparator with NaN the same way an unguarded duration would — then
 *    earlier start_time, then earlier original array position (both
 *    fully deterministic, so this order has no remaining ties at all —
 *    it's a strict total order).
 *
 * 3. Walk that order once, accepting a candidate into `kept` only if its
 *    overlapRatio() against EVERY candidate already in `kept` is below the
 *    threshold — not just the most recently kept one. `kept` starts empty
 *    (vacuously conflict-free), and each accepted candidate is proven
 *    conflict-free against the ENTIRE current kept set before being added,
 *    so by induction `kept` stays conflict-free after every step. Nothing
 *    already accepted is ever removed or replaced, which is exactly what
 *    makes a candidate that conflicts with several already-kept candidates
 *    safe to handle: it's simply rejected the moment it conflicts with any
 *    one of them, however many that is — there's no "replace A with B,
 *    then discover B also conflicts with C" case to chase, because B was
 *    already checked against C (and everything else in `kept`) before
 *    being accepted in the first place.
 *
 * 4. Re-sort the surviving set into chronological order for the return
 *    value — the preference order in step 2 exists only to decide WHO
 *    wins a conflict, not what order survivors are presented in. (Two
 *    valid, non-conflicting segments can never share an identical
 *    start_time: if they did, the shorter one's entire span would sit
 *    inside the longer one's, giving ratio 1.0, which always conflicts —
 *    so sorting by start_time alone is already unambiguous for anything
 *    that actually survives; original array position is kept only as a
 *    defensive final tiebreaker, never expected to matter in practice.)
 */
export function dedupeOverlappingSegments(segments: SelectedSegment[]): SelectedSegment[] {
  const candidates = segments
    .map((segment, originalIndex) => ({ segment, originalIndex }))
    .filter(
      ({ segment }) =>
        Number.isFinite(segment.start_time) && Number.isFinite(segment.end_time) && segment.end_time > segment.start_time,
    );

  const byPreference = [...candidates].sort((a, b) => {
    const durationA = a.segment.end_time - a.segment.start_time;
    const durationB = b.segment.end_time - b.segment.start_time;
    if (durationA !== durationB) return durationB - durationA; // longer first

    // Confidence only ever breaks an exact duration tie, and only when
    // it's actually usable on both sides — a missing/non-finite value
    // (this field isn't re-validated at this layer) must never reach the
    // subtraction below, or it poisons the comparator with NaN.
    const confidenceA = a.segment.confidence;
    const confidenceB = b.segment.confidence;
    if (Number.isFinite(confidenceA) && Number.isFinite(confidenceB) && confidenceA !== confidenceB) {
      return confidenceB - confidenceA; // higher confidence first, tie-break only
    }

    if (a.segment.start_time !== b.segment.start_time) return a.segment.start_time - b.segment.start_time; // earlier first
    return a.originalIndex - b.originalIndex; // final, always-decisive tiebreak
  });

  const kept: typeof candidates = [];
  for (const candidate of byPreference) {
    const conflicts = kept.some((k) => overlapRatio(candidate.segment, k.segment) >= OVERLAP_RATIO_THRESHOLD);
    if (!conflicts) kept.push(candidate);
  }

  return kept
    .sort((a, b) => a.segment.start_time - b.segment.start_time || a.originalIndex - b.originalIndex)
    .map((k) => k.segment);
}

export async function selectSegments(
  contentType: ContentType,
  transcript: Transcript | null,
  audioAnalysis: AudioAnalysis | null,
  maxEndSeconds: number,
): Promise<SelectedSegment[]> {
  const prompt = buildPrompt(contentType, transcript, audioAnalysis, maxEndSeconds);

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

      const valid = parsed.data.segments.filter((s) => s.end_time > s.start_time && s.end_time <= maxEndSeconds + 0.5);
      if (valid.length > 0) return valid;
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
      console.error(`[selectSegments] Anthropic call failed (attempt ${attempt + 1}, status ${status ?? "n/a"}):`, err instanceof Error ? err.message : err);
      // fall through to retry, then to the heuristic fallback below
    }
  }

  return heuristicFallback(contentType, transcript, audioAnalysis, maxEndSeconds);
}
