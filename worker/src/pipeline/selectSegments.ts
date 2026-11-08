import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../lib/env.js";
import type { AudioAnalysis, ContentType, SelectedSegment, Transcript, TranscriptWord } from "../lib/database.types.js";

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

// Only the one method selectSegments() actually calls — lets tests inject a
// fake client (see selectSegments.test.mts) instead of mocking the whole
// SDK module, without introducing any new abstraction beyond this one seam.
// Mirrors the identical pattern already established in scenePlanner.ts.
type AnthropicMessagesClient = Pick<Anthropic, "messages">;

export interface Sentence {
  text: string;
  start: number; // seconds
  end: number; // seconds
}

// Bounds how long a sentence may grow without terminal punctuation before
// being force-closed anyway. Necessary for transcripts with sparse or
// absent punctuation (auto-generated transcription of run-on or informal
// speech) — without this, a punctuation-free transcript would collapse
// into exactly one "sentence" covering the entire thing, which is exactly
// what groupIntoSentences must not do. 20s is deliberately well under
// MAX_CLIP_SECONDS (45, so one forced sentence can never by itself eat an
// unreasonable share of the longest allowed clip) and comfortably above a
// typical real spoken sentence's length, so in practice this only ever
// fires on genuinely punctuation-sparse stretches, not on ordinary long
// (but legitimately single) sentences.
const MAX_SENTENCE_SECONDS = 20;

// Matches a word ending in one or more sentence-ending marks, optionally
// followed by a closing quote/paren/bracket (e.g. `said."` or `"Really?"`).
// Known, accepted limitation: this has no abbreviation detection (e.g.
// "Mr." would end a sentence early) — deliberately not handled, since
// AssemblyAI's own punctuate/format_text output transcribes spoken words
// rather than typed abbreviations, making this a low-frequency edge case,
// and handling it would mean guessing at a list of abbreviations rather
// than a clean, understandable rule.
const SENTENCE_END_RE = /[.!?]+["')\]]*$/;

/**
 * Groups a word-level transcript into sentence-level chunks using the
 * punctuation AssemblyAI already attaches to each word's own text (see
 * transcribe.ts's `punctuate: true, format_text: true` request) — no new
 * API call, no new service, purely a local pass over data already fetched.
 *
 * Preserves chronological word order (words are defensively sorted by
 * start time first — a no-op for AssemblyAI's actual output, which is
 * always already chronological, but it guards a malformed transcript
 * against processing words out of order), computes each sentence's bounds
 * as the MINIMUM start and MAXIMUM end across every word in it — not just
 * the first/last word by position — so an overlapping word (one whose
 * span is partly or fully covered by another word in the same sentence)
 * can never make the sentence's own boundary backward or shorter than the
 * content it actually contains; for ordinary non-overlapping input this is
 * exactly the first word's start and the last word's end, so it changes
 * nothing for the common case. Never emits an empty sentence, and never
 * lets one sentence swallow an unbounded stretch of a punctuation-sparse
 * or unpunctuated transcript (see MAX_SENTENCE_SECONDS above). Returns
 * `[]` only when the input has no words at all.
 */
export function groupIntoSentences(transcript: Transcript): Sentence[] {
  const sentences: Sentence[] = [];
  let buffer: TranscriptWord[] = [];
  let bufferStart = 0;
  let bufferEnd = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.map((w) => w.text).join(" ").trim();
    const start = bufferStart;
    const end = bufferEnd;
    buffer = [];
    if (!text) return; // defensive: never emit an empty sentence
    sentences.push({ text, start: start / 1000, end: end / 1000 });
  };

  // Defensive: sort by start time before processing (see doc comment above).
  const words = [...transcript.words].sort((a, b) => a.start - b.start);

  for (const word of words) {
    if (!word.text || !word.text.trim()) continue; // skip stray empty tokens defensively
    // Defensive: skip a word with a non-finite or inverted timestamp
    // (mirrors the Number.isFinite() guards already applied in
    // dedupeOverlappingSegments). Without this, a single corrupted word
    // would poison its whole sentence's start/end with NaN/Infinity, which
    // would then render as a garbled timestamp in the prompt text sent to
    // the model instead of being caught here.
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) continue;

    // Track true min-start/max-end incrementally rather than re-deriving
    // them from buffer[0]/buffer[last] — this is what makes an overlapping
    // word (e.g. a long word A=[0,5] containing a short, sentence-ending
    // word B=[1,2]) correctly extend the sentence's end to A's end (5),
    // not collapse it to B's own end (2) just because B happens to be
    // last in sorted order.
    if (buffer.length === 0) {
      bufferStart = word.start;
      bufferEnd = word.end;
    } else {
      if (word.start < bufferStart) bufferStart = word.start;
      if (word.end > bufferEnd) bufferEnd = word.end;
    }
    buffer.push(word);

    const endsSentence = SENTENCE_END_RE.test(word.text.trim());
    const bufferDurationSeconds = (bufferEnd - bufferStart) / 1000;

    if (endsSentence || bufferDurationSeconds >= MAX_SENTENCE_SECONDS) {
      flush();
    }
  }
  flush(); // trailing words with no terminal punctuation

  return sentences;
}

// contentType === "music" (or no transcript) must produce byte-identical
// prompt text to before this change — the spoken-only additions below
// (spokenRules, the sentence-grouped transcript section) are appended only
// inside the `contentType === "spoken" && transcript` branch, never
// touching this shared `instructions` block or the music branch at the
// bottom of this function. `sentences` is computed once by the caller
// (selectSegments) and passed in here, rather than this function calling
// groupIntoSentences() itself — see selectSegments() for why: the exact
// same list must also be reused for the snap step, not recomputed.
function buildPrompt(
  contentType: ContentType,
  transcript: Transcript | null,
  audioAnalysis: AudioAnalysis | null,
  maxEndSeconds: number,
  sentences: Sentence[],
) {
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
    const spokenRules = `Additional rules for spoken content:
- Standalone completeness: start_time must land exactly on the START of one of the sentences listed below, and end_time must land exactly on the END of one of the sentences listed below — never mid-sentence. Never start on a pronoun or reference ("it", "that", "this", "she", "they") whose meaning depends on something said earlier that isn't included in the clip.
- Strong opening: the clip's first sentence must itself be a reason to keep watching — a question, a bold claim, a surprising statement. Never open on filler, an introduction, or a meaningless transition ("so anyway", "let me tell you about", "okay so").
- Meaningful payoff: prefer a moment that builds to a conclusion, reveal, punchline, result, or emotional turn — and that payoff must actually happen within the clip, using only what the sentences below actually say. Never select a moment whose setup promises a payoff that doesn't occur in the available transcript, and never invent or imply an outcome that isn't actually said.
- Variety: the moments you select must cover meaningfully different points, topics, stories, or emotional beats. Do not select two moments that make essentially the same point, even if their timestamps don't overlap.
- Natural endings: end exactly at the end of a sentence, after the thought or moment has resolved — never cut away mid-sentence or mid-thought.`;

    const sentenceText = sentences
      .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
      .join("\n");
    return `${instructions}\n\n${spokenRules}\n\nTRANSCRIPT (sentences, start-end timestamps in seconds):\n${sentenceText}`;
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

// How close (in seconds) a model-returned timestamp must already be to a
// sentence boundary before it's snapped to that boundary exactly. 1.5s is
// generous enough to correct the kind of small arithmetic/copy drift a
// model typically introduces when transcribing a timestamp out of a long
// prompt (sub-second to low-single-digit-second), while small enough that
// it could never be mistaken for the model having actually intended a
// different, further-away sentence.
const ABSOLUTE_SNAP_TOLERANCE_SECONDS = 1.5;
// Additionally, never snap across more than this fraction of the
// candidate boundary's OWN sentence duration — this is what satisfies "do
// not move a timestamp across a substantial portion of a sentence": for a
// short ~2s sentence the absolute cap above would still let a snap eat a
// large share of it (1.5s of a 2s sentence), so the effective tolerance is
// whichever of the two caps is tighter, and for short sentences that's
// always this one.
const RELATIVE_SNAP_FRACTION = 0.25;

// Known, accepted limitation: start_time and end_time are snapped
// INDEPENDENTLY, each to its own nearest same-type boundary. When sentence
// boundaries are bunched close together (several short sentences in quick
// succession), the two independent snaps can land on boundaries that
// together span a different combination of sentences than the model's raw
// numbers suggested — e.g. the model's own end_time was 1.3s past sentence
// S4's end and 1.4s short of S5's end, nearest-boundary snapping picks S4's
// end, and the clip ends up covering S1-S4 rather than whatever mix of
// S1-S5 the model actually had in mind. This does not mean the "moment" is
// lost — the result is still a valid, sentence-aligned clip built from
// content adjacent to what the model selected — but the corrected interval
// can legitimately represent different content than intended.
//
// A cross-check was considered (reject a snap whose combined [start, end]
// doesn't substantially overlap the model's original [start, end], the
// same idea as Step 1's overlapRatio) and deliberately not added: any such
// check would use exactly the same distance information the per-endpoint
// tolerance already uses, so it cannot distinguish "snapped to the wrong
// neighbor" from "snapped to the right one" any better than the existing
// tolerance does — and a check strict enough to catch the former would
// also reject legitimate multi-sentence clips, where start_time and
// end_time are SUPPOSED to snap to boundaries several sentences apart.
// Each individual snap stays bounded (at most
// ABSOLUTE_SNAP_TOLERANCE_SECONDS, and at most RELATIVE_SNAP_FRACTION of
// the sentence it snaps to), which is the honest limit on how far this
// risk can reach; narrowing it further is not justified without a way to
// tell the two cases apart that doesn't already exist here.
function snapToNearestSentenceBoundary(time: number, sentences: Sentence[], boundary: "start" | "end"): number {
  let nearest: number | null = null;
  let nearestDistance = Infinity;
  let nearestSentenceDuration = 0;

  for (const sentence of sentences) {
    const candidate = boundary === "start" ? sentence.start : sentence.end;
    const distance = Math.abs(candidate - time);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
      nearestSentenceDuration = sentence.end - sentence.start;
    }
  }

  if (nearest === null) return time; // no sentences to snap against — leave the model's own value alone

  const tolerance = Math.min(ABSOLUTE_SNAP_TOLERANCE_SECONDS, RELATIVE_SNAP_FRACTION * nearestSentenceDuration);
  return nearestDistance <= tolerance ? nearest : time;
}

/**
 * Corrects a model-returned segment's start_time/end_time to land exactly
 * on the nearest sentence boundary from the same sentence list the prompt
 * supplied — only when that boundary is already within tolerance (see
 * ABSOLUTE_SNAP_TOLERANCE_SECONDS/RELATIVE_SNAP_FRACTION above). A no-op
 * (returns `segment` unchanged) for music, for a null/empty transcript, or
 * for any segment whose timestamps are already outside tolerance of every
 * sentence boundary — there's deliberately no "snap to the closest thing
 * however far" behavior; outside tolerance, the model's own value is left
 * exactly as returned.
 *
 * Revalidates the result as a single unit: if snapping would collapse the
 * clip to zero/negative length, or push its duration outside the
 * [MIN_CLIP_SECONDS, MAX_CLIP_SECONDS] bounds the rest of the pipeline
 * already relies on, or push end_time past maxEndSeconds (the same +0.5s
 * epsilon selectSegments() already uses elsewhere), the snap is rejected
 * in its entirety and the original, unsnapped segment is returned instead
 * — never a partially-corrected segment where only one side moved.
 */
function snapSegmentToSentenceBoundaries(segment: SelectedSegment, sentences: Sentence[], maxEndSeconds: number): SelectedSegment {
  if (sentences.length === 0) return segment;

  const snappedStart = snapToNearestSentenceBoundary(segment.start_time, sentences, "start");
  const snappedEnd = snapToNearestSentenceBoundary(segment.end_time, sentences, "end");

  if (snappedStart === segment.start_time && snappedEnd === segment.end_time) {
    return segment; // nothing moved
  }

  const snappedDuration = snappedEnd - snappedStart;
  const isValid =
    snappedDuration >= MIN_CLIP_SECONDS &&
    snappedDuration <= MAX_CLIP_SECONDS &&
    snappedStart >= 0 &&
    snappedEnd <= maxEndSeconds + 0.5;

  if (!isValid) return segment; // reject the snap entirely rather than return an inconsistent result

  return { ...segment, start_time: snappedStart, end_time: snappedEnd };
}

export async function selectSegments(
  contentType: ContentType,
  transcript: Transcript | null,
  audioAnalysis: AudioAnalysis | null,
  maxEndSeconds: number,
  client: AnthropicMessagesClient = anthropic,
): Promise<SelectedSegment[]> {
  // Computed exactly once here — [] whenever contentType isn't spoken or
  // transcript is null/empty, which is exactly what makes the snap step a
  // guaranteed no-op for music (see snapSegmentToSentenceBoundaries above):
  // this is structural, not just a convention this code happens to follow.
  // Passed into buildPrompt() below for the prompt's transcript section,
  // and reused again for the snap step after the model responds — the
  // same list both places, not recomputed a second time via a second
  // groupIntoSentences() call inside buildPrompt() itself.
  const sentences = contentType === "spoken" && transcript ? groupIntoSentences(transcript) : [];
  const prompt = buildPrompt(contentType, transcript, audioAnalysis, maxEndSeconds, sentences);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
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

      // start_time >= 0 is explicit here even though segmentSchema already
      // declares start_time as z.number().nonnegative() (so a negative
      // value fails the whole response's parse above, before reaching
      // this line, under the current schema) — kept explicit anyway as
      // defense-in-depth at this specific filter, consistent with the
      // explicit end_time checks right beside it, rather than relying on
      // an upstream schema detail a future reader of just this line might
      // not know about.
      const valid = parsed.data.segments.filter((s) => s.start_time >= 0 && s.end_time > s.start_time && s.end_time <= maxEndSeconds + 0.5);
      // Enforce the 12-45s duration requirement here, on the model's raw
      // timestamps, rather than relying on prompt text alone — this must
      // run BEFORE snapping (not just after it) because a segment whose
      // endpoints are already exactly on sentence boundaries never enters
      // snapSegmentToSentenceBoundaries' own revalidation at all (its
      // early "nothing moved" return skips that check entirely). Rejecting
      // out-of-range segments here, rather than stretching/shrinking them,
      // keeps every later stage (snapping, Step 1's overlap filter)
      // operating only on durations the rest of the pipeline already
      // assumes are valid.
      const validDuration = valid.filter((s) => {
        const duration = s.end_time - s.start_time;
        return duration >= MIN_CLIP_SECONDS && duration <= MAX_CLIP_SECONDS;
      });
      if (validDuration.length > 0) {
        return validDuration.map((s) => snapSegmentToSentenceBoundaries(s, sentences, maxEndSeconds));
      }
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
      console.error(`[selectSegments] Anthropic call failed (attempt ${attempt + 1}, status ${status ?? "n/a"}):`, err instanceof Error ? err.message : err);
      // fall through to retry, then to the heuristic fallback below
    }
  }

  return heuristicFallback(contentType, transcript, audioAnalysis, maxEndSeconds);
}
