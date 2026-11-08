// Tests for worker/src/pipeline/selectSegments.ts, in two groups:
//
// 1. dedupeOverlappingSegments() — Step 1's deterministic overlap filter.
//    Imported directly, no fakes needed: it's a pure function.
// 2. groupIntoSentences(), the boundary-snap step, and selectSegments()
//    itself — Step 2's additions. selectSegments() now takes an
//    injectable Anthropic client (mirroring scenePlanner.ts's existing
//    DI pattern), so these tests use a fake client and make no real,
//    paid API calls.
//
// Tests assert on BEHAVIOR (the pairwise overlap guarantee, which
// survivors remain, chronological ordering of the output, what prompt
// text actually gets sent, what the final returned segments look like)
// rather than on implementation details like sort-comparator internals
// or the private snap helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeOverlappingSegments, OVERLAP_RATIO_THRESHOLD, groupIntoSentences, selectSegments, MIN_CLIP_SECONDS } from "./selectSegments.js";
import type { SelectedSegment, Transcript, TranscriptWord } from "../lib/database.types.js";

// selectSegments()'s injectable client parameter is typed with a private,
// unexported Pick<Anthropic, "messages"> alias (mirroring scenePlanner.ts's
// identical pattern) — Parameters<> below recovers that exact type without
// needing selectSegments.ts to export an implementation-detail type just
// for tests.
type FakeAnthropicClient = Parameters<typeof selectSegments>[4];

function makeFakeClient(responses: string[]): FakeAnthropicClient & { calls: unknown[] } {
  let callIndex = 0;
  const calls: unknown[] = [];
  const client = {
    calls,
    messages: {
      async create(args: unknown) {
        calls.push(args);
        const responseText = responses[Math.min(callIndex, responses.length - 1)];
        callIndex++;
        if (responseText === "__THROW__") throw new Error("simulated Anthropic API failure");
        return { content: [{ type: "text", text: responseText }] };
      },
    },
  };
  return client as unknown as FakeAnthropicClient & { calls: unknown[] };
}

function promptTextFrom(call: unknown): string {
  const messages = (call as { messages: { content: string }[] }).messages;
  return messages[0].content;
}

function makeWord(text: string, startMs: number, endMs: number): TranscriptWord {
  return { text, start: startMs, end: endMs };
}

function makeTranscript(words: TranscriptWord[]): Transcript {
  return { full_text: words.map((w) => w.text).join(" "), words };
}

function makeSegment(overrides: Partial<SelectedSegment>): SelectedSegment {
  return {
    start_time: 0,
    end_time: 20,
    hook_type: "emotional",
    suggested_caption: "test",
    confidence: 70,
    ...overrides,
  };
}

// Independently recomputes the same ratio the implementation is supposed
// to guarantee against — intersection / min(duration) — so tests can
// assert the actual behavioral property (no surviving pair crosses the
// threshold) without reaching into the module's private overlapRatio().
function overlapRatio(a: SelectedSegment, b: SelectedSegment): number {
  const intersection = Math.max(0, Math.min(a.end_time, b.end_time) - Math.max(a.start_time, b.start_time));
  const shorter = Math.min(a.end_time - a.start_time, b.end_time - b.start_time);
  return shorter <= 0 ? 0 : intersection / shorter;
}

function assertNoConflictingPairs(result: SelectedSegment[]): void {
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const ratio = overlapRatio(result[i], result[j]);
      assert.ok(
        ratio < OVERLAP_RATIO_THRESHOLD,
        `survivors at index ${i} and ${j} still overlap at ratio ${ratio.toFixed(2)} (>= ${OVERLAP_RATIO_THRESHOLD})`,
      );
    }
  }
}

function assertChronological(result: SelectedSegment[]): void {
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].start_time >= result[i - 1].start_time, "result must be in non-decreasing start_time order");
  }
}

test("the three real overlapping production examples collapse to a conflict-free set", () => {
  // Verbatim from the audit: Clip 1 0:17-0:37, Clip 2 0:07-0:27, Clip 3
  // 0:00-0:13 — against the shorter-duration-relative metric, clip1/clip2
  // and clip2/clip3 both come out around 0.46-0.50 (see
  // OVERLAP_RATIO_THRESHOLD's own comment), both above the 0.4 threshold.
  const clip1 = makeSegment({ start_time: 17, end_time: 37, confidence: 80 });
  const clip2 = makeSegment({ start_time: 7, end_time: 27, confidence: 75 });
  const clip3 = makeSegment({ start_time: 0, end_time: 13, confidence: 90 });

  const result = dedupeOverlappingSegments([clip1, clip2, clip3]);

  assertNoConflictingPairs(result);
  assert.ok(result.length < 3, "at least one of the three mutually-overlapping clips must be dropped");
  assertChronological(result);
});

test("completely separate clips all survive unchanged", () => {
  const a = makeSegment({ start_time: 0, end_time: 15 });
  const b = makeSegment({ start_time: 20, end_time: 35 });
  const c = makeSegment({ start_time: 40, end_time: 55 });

  const result = dedupeOverlappingSegments([a, b, c]);

  assert.equal(result.length, 3);
  assert.deepEqual(result, [a, b, c]);
});

test("a small boundary overlap between adjacent clips is not treated as a conflict", () => {
  // 2s shared out of a 20s shorter segment -> ratio 0.1, well under 0.4.
  const a = makeSegment({ start_time: 0, end_time: 20 });
  const b = makeSegment({ start_time: 18, end_time: 38 });

  const result = dedupeOverlappingSegments([a, b]);

  assert.equal(result.length, 2, "both adjacent, mostly-distinct clips must be kept");
  assertNoConflictingPairs(result);
});

test("unsorted input produces the same surviving set as sorted input", () => {
  const a = makeSegment({ start_time: 0, end_time: 15, confidence: 60 });
  const b = makeSegment({ start_time: 20, end_time: 35, confidence: 60 });
  const overlapsA = makeSegment({ start_time: 2, end_time: 14, confidence: 60 }); // shorter, conflicts with a

  const sortedOrder = dedupeOverlappingSegments([a, b, overlapsA]);
  const shuffledOrder = dedupeOverlappingSegments([overlapsA, b, a]);

  const toKey = (s: SelectedSegment) => `${s.start_time}-${s.end_time}`;
  assert.deepEqual(new Set(sortedOrder.map(toKey)), new Set(shuffledOrder.map(toKey)));
});

test("invalid and zero-length segments are dropped safely, never thrown", () => {
  const valid = makeSegment({ start_time: 0, end_time: 15 });
  const zeroLength = makeSegment({ start_time: 30, end_time: 30 });
  const negativeLength = makeSegment({ start_time: 50, end_time: 40 });

  const result = dedupeOverlappingSegments([valid, zeroLength, negativeLength]);

  assert.deepEqual(result, [valid]);
});

test("equal-duration conflict is broken by confidence", () => {
  const lowerConfidence = makeSegment({ start_time: 0, end_time: 20, confidence: 50 });
  const higherConfidence = makeSegment({ start_time: 5, end_time: 25, confidence: 90 }); // same 20s duration, overlaps

  const result = dedupeOverlappingSegments([lowerConfidence, higherConfidence]);

  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, 90, "the higher-confidence segment must win an exact duration tie");
});

test("a longer, lower-confidence clip defeats a shorter, higher-confidence clip", () => {
  const longerLowerConfidence = makeSegment({ start_time: 0, end_time: 30, confidence: 40 });
  const shorterHigherConfidence = makeSegment({ start_time: 5, end_time: 20, confidence: 95 }); // fully inside the longer one

  const result = dedupeOverlappingSegments([longerLowerConfidence, shorterHigherConfidence]);

  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, 40, "duration must win over confidence — confidence is only a tiebreaker for equal durations");
});

test("one candidate conflicting with multiple retained candidates never leaves a conflicting pair behind", () => {
  // a and c are far enough apart to both be legitimately kept on their own.
  // b is short and sits in the middle, overlapping BOTH a and c heavily.
  const a = makeSegment({ start_time: 0, end_time: 20, confidence: 50 });
  const c = makeSegment({ start_time: 15, end_time: 35, confidence: 50 });
  const b = makeSegment({ start_time: 10, end_time: 22, confidence: 99 }); // shorter than both, high confidence, conflicts with both

  const result = dedupeOverlappingSegments([a, b, c]);

  assertNoConflictingPairs(result);
  // b must lose to at least whichever of a/c it conflicts with by duration
  // — the key guarantee is simply that nothing conflicting survives
  // together, proven generically by assertNoConflictingPairs above.
});

test("results are deterministic across repeated calls on the same input", () => {
  const segments = [
    makeSegment({ start_time: 17, end_time: 37, confidence: 80 }),
    makeSegment({ start_time: 7, end_time: 27, confidence: 75 }),
    makeSegment({ start_time: 0, end_time: 13, confidence: 90 }),
  ];

  const first = dedupeOverlappingSegments(segments);
  const second = dedupeOverlappingSegments(segments);

  assert.deepEqual(first, second);
});

test("a no-op when nothing overlaps — chronologically-ordered input returns unchanged", () => {
  const segments = [
    makeSegment({ start_time: 0, end_time: 12 }),
    makeSegment({ start_time: 15, end_time: 30 }),
    makeSegment({ start_time: 35, end_time: 45 }),
  ];

  const result = dedupeOverlappingSegments(segments);

  assert.deepEqual(result, segments);
});

test("a single segment (the synthetic whole-window case) is returned unchanged", () => {
  const only = makeSegment({ start_time: 0, end_time: 8, confidence: 100, suggested_caption: "the whole moment" });

  const result = dedupeOverlappingSegments([only]);

  assert.deepEqual(result, [only]);
});

test("an empty array is handled safely", () => {
  assert.deepEqual(dedupeOverlappingSegments([]), []);
});

test("an overlap ratio exactly equal to OVERLAP_RATIO_THRESHOLD is treated as a conflict (>=, not >)", () => {
  // shorter = min(10,14) = 10; intersection = min(10,20)-max(0,6) = 4;
  // ratio = 4/10 = 0.4 exactly.
  const shorter = makeSegment({ start_time: 0, end_time: 10, confidence: 90 });
  const longer = makeSegment({ start_time: 6, end_time: 20, confidence: 50 });
  assert.equal(overlapRatio(shorter, longer), OVERLAP_RATIO_THRESHOLD, "fixture must hit exactly 0.4, not just near it");

  const result = dedupeOverlappingSegments([shorter, longer]);

  assert.equal(result.length, 1, "a ratio exactly at the threshold must still be rejected as a conflict");
  assert.equal(result[0].end_time, 20, "the longer segment must win regardless of its lower confidence");
});

test("an overlap ratio just under OVERLAP_RATIO_THRESHOLD is not a conflict", () => {
  // shorter = min(10, 13.9) = 10; intersection = 10 - 6.1 = 3.9; ratio = 0.39.
  const a = makeSegment({ start_time: 0, end_time: 10 });
  const b = makeSegment({ start_time: 6.1, end_time: 20 });

  const result = dedupeOverlappingSegments([a, b]);

  assert.equal(result.length, 2, "a ratio just below the threshold must not be treated as a conflict");
});

test("non-finite timestamps (NaN, Infinity, -Infinity) are rejected safely, never thrown and never corrupting the sort", () => {
  const valid1 = makeSegment({ start_time: 0, end_time: 10 });
  const valid2 = makeSegment({ start_time: 50, end_time: 60 });
  const nanEnd = makeSegment({ start_time: 20, end_time: NaN });
  const nanStart = makeSegment({ start_time: NaN, end_time: 30 });
  const infiniteEnd = makeSegment({ start_time: 70, end_time: Infinity });
  const negativeInfiniteStart = makeSegment({ start_time: -Infinity, end_time: 80 });
  const bothInfinite = makeSegment({ start_time: Infinity, end_time: Infinity });

  const result = dedupeOverlappingSegments([valid1, nanEnd, nanStart, valid2, infiniteEnd, negativeInfiniteStart, bothInfinite]);

  assert.deepEqual(result, [valid1, valid2], "every non-finite-timestamp segment must be dropped, leaving only the two valid ones, in order");
});

test("non-finite or missing confidence never destabilizes the sort — falls through to the next tiebreaker instead", () => {
  // Equal duration (both 20s) so confidence would normally be the
  // tiebreaker — but one side's confidence is NaN, so the comparator must
  // fall through to start_time instead of computing NaN - 70.
  const nanConfidence = makeSegment({ start_time: 10, end_time: 30, confidence: NaN });
  const normalConfidence = makeSegment({ start_time: 0, end_time: 20, confidence: 70 });

  const result = dedupeOverlappingSegments([nanConfidence, normalConfidence]);

  assert.equal(result.length, 1, "the two equal-duration, overlapping segments must still collapse to one");
  assert.equal(result[0].start_time, 0, "with confidence unusable on one side, the earlier start_time must win the tiebreak");

  // Simulates a runtime value that violates the (non-optional) type —
  // defensive coverage, since nothing upstream is schema-revalidated at
  // this layer.
  const missingConfidence = { ...makeSegment({ start_time: 10, end_time: 30 }), confidence: undefined } as unknown as SelectedSegment;
  const withConfidence = makeSegment({ start_time: 0, end_time: 20, confidence: 70 });

  const resultMissing = dedupeOverlappingSegments([missingConfidence, withConfidence]);

  assert.equal(resultMissing.length, 1);
  assert.equal(resultMissing[0].start_time, 0, "a missing confidence value must not throw or produce NaN — falls through to start_time");
});

// --- groupIntoSentences() ---

test("groupIntoSentences: splits on periods, questions, and exclamations, preserving text and exact timestamps", () => {
  const transcript = makeTranscript([
    makeWord("That's", 0, 300),
    makeWord("amazing.", 300, 800),
    makeWord("Really?", 900, 1400),
    makeWord("Wow!", 1500, 2000),
  ]);

  const sentences = groupIntoSentences(transcript);

  assert.deepEqual(sentences, [
    { text: "That's amazing.", start: 0, end: 0.8 },
    { text: "Really?", start: 0.9, end: 1.4 },
    { text: "Wow!", start: 1.5, end: 2.0 },
  ]);
});

test("groupIntoSentences: preserves original word order within a sentence", () => {
  const transcript = makeTranscript([
    makeWord("One", 0, 100),
    makeWord("two", 100, 200),
    makeWord("three.", 200, 300),
  ]);

  const [sentence] = groupIntoSentences(transcript);

  assert.equal(sentence.text, "One two three.");
});

test("groupIntoSentences: a long, punctuation-free transcript is force-split rather than becoming one giant sentence", () => {
  const words: TranscriptWord[] = [];
  for (let i = 0; i < 40; i++) {
    words.push(makeWord(`word${i}`, i * 1000, (i + 1) * 1000)); // 40 one-second words, no punctuation at all
  }
  const transcript = makeTranscript(words);

  const sentences = groupIntoSentences(transcript);

  assert.ok(sentences.length > 1, "a 40-second punctuation-free transcript must not collapse into one sentence");
  for (const sentence of sentences) {
    assert.ok(sentence.end - sentence.start <= 20, "no forced sentence may exceed the MAX_SENTENCE_SECONDS bound");
  }
  // Every word must still be accounted for somewhere, in order.
  assert.equal(sentences.map((s) => s.text).join(" "), words.map((w) => w.text).join(" "));
});

test("groupIntoSentences: a short punctuation-free transcript becomes exactly one sentence", () => {
  const transcript = makeTranscript([makeWord("hello", 0, 500), makeWord("there", 500, 1000)]);

  const sentences = groupIntoSentences(transcript);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "hello there");
});

test("groupIntoSentences: a single-sentence transcript returns exactly one sentence", () => {
  const transcript = makeTranscript([makeWord("Done.", 0, 500)]);

  const sentences = groupIntoSentences(transcript);

  assert.deepEqual(sentences, [{ text: "Done.", start: 0, end: 0.5 }]);
});

test("groupIntoSentences: never emits an empty sentence, and an empty transcript returns no sentences", () => {
  assert.deepEqual(groupIntoSentences(makeTranscript([])), []);

  // Defensive: a stray empty/whitespace-only word token must be skipped,
  // never producing a sentence with empty text.
  const transcript = makeTranscript([makeWord("  ", 0, 100), makeWord("Hi.", 100, 300)]);
  const sentences = groupIntoSentences(transcript);
  assert.ok(sentences.every((s) => s.text.length > 0));
  assert.deepEqual(sentences, [{ text: "Hi.", start: 0.1, end: 0.3 }]);
});

test("groupIntoSentences: out-of-order words are sorted by start time before grouping", () => {
  // Defensive: a malformed transcript with words out of chronological
  // order must not produce a sentence whose start/end are wrong simply
  // because of array position (buffer[0].start / buffer[last].end).
  const transcript = makeTranscript([
    makeWord("Second", 5000, 5500),
    makeWord("word.", 5500, 6000),
    makeWord("First", 0, 500),
    makeWord("word.", 500, 1000),
  ]);
  const sentences = groupIntoSentences(transcript);
  assert.deepEqual(sentences, [
    { text: "First word.", start: 0, end: 1 },
    { text: "Second word.", start: 5, end: 6 },
  ]);
});

test("groupIntoSentences: a word with a non-finite or inverted timestamp is skipped, not propagated", () => {
  // Defensive: a single corrupted word's timestamp must never poison its
  // sentence's start/end with NaN/Infinity (mirrors the Number.isFinite()
  // guards already applied in dedupeOverlappingSegments).
  const withInfinity = makeTranscript([makeWord("Normal.", 0, 500), makeWord("Bad", Infinity, Infinity), makeWord("word.", 1000, 1500)]);
  assert.deepEqual(groupIntoSentences(withInfinity), [
    { text: "Normal.", start: 0, end: 0.5 },
    { text: "word.", start: 1, end: 1.5 },
  ]);

  const withNaN = makeTranscript([makeWord("Normal.", 0, 500), makeWord("Bad", NaN, NaN), makeWord("word.", 1000, 1500)]);
  assert.deepEqual(groupIntoSentences(withNaN), [
    { text: "Normal.", start: 0, end: 0.5 },
    { text: "word.", start: 1, end: 1.5 },
  ]);

  const inverted = makeTranscript([makeWord("Normal.", 0, 500), makeWord("Bad", 2000, 1000), makeWord("word.", 1000, 1500)]);
  assert.deepEqual(groupIntoSentences(inverted), [
    { text: "Normal.", start: 0, end: 0.5 },
    { text: "word.", start: 1, end: 1.5 },
  ]);
});

test("groupIntoSentences: an overlapping word's span is accounted for, not just the chronologically-last word's own end", () => {
  // Word A spans [0, 5], fully containing word B's span [1, 2] — B happens
  // to be the word that carries the sentence-ending punctuation (and, by
  // start time, sorts after A). Taking only the LAST word's own end (by
  // array position after sorting) would incorrectly produce a sentence
  // ending at 2s, even though A's own span extends to 5s — losing real
  // transcript content from the computed boundary. The sentence's end
  // must be the MAX end across every word in it, not just the final
  // word's.
  const transcript = makeTranscript([makeWord("A", 0, 5000), makeWord("B.", 1000, 2000)]);

  const sentences = groupIntoSentences(transcript);

  assert.deepEqual(sentences, [{ text: "A B.", start: 0, end: 5 }]);
});

test("groupIntoSentences: every produced sentence has a chronologically valid (non-backward) start/end, even with overlapping word timestamps", () => {
  const transcript = makeTranscript([
    makeWord("First", 0, 5000),
    makeWord("sentence.", 1000, 2000), // fully contained within "First"'s span
    makeWord("Second", 3000, 3500),
    makeWord("sentence,", 3200, 6000), // overlaps "Second" without being contained by it
    makeWord("done.", 6000, 6500),
  ]);

  const sentences = groupIntoSentences(transcript);

  for (const sentence of sentences) {
    assert.ok(sentence.end >= sentence.start, `sentence "${sentence.text}" must not have a backward boundary (start=${sentence.start}, end=${sentence.end})`);
  }
  assert.deepEqual(sentences, [
    { text: "First sentence.", start: 0, end: 5 },
    { text: "Second sentence, done.", start: 3, end: 6.5 },
  ]);
});

// --- selectSegments() + fake client: prompt content, boundary snapping, retries, composition ---

function spokenFixtureTranscript(): Transcript {
  // Three sentences with clean round-number boundaries, spaced so that
  // snapping/tolerance math below is easy to verify by hand:
  //   S1 [0.0s, 3.0s]  (3.0s)
  //   S2 [3.2s, 7.0s]  (3.8s)
  //   S3 [8.0s, 23.0s] (15.0s) — long enough to be a valid 12-45s clip on its own
  return makeTranscript([
    makeWord("One.", 0, 3000),
    makeWord("Two.", 3200, 7000),
    makeWord("Three, a much longer sentence that goes on for a while and resolves.", 8000, 23000),
  ]);
}

test("selectSegments prompt: spoken content includes the new standalone/opening/payoff/variety/ending criteria and the sentence-list transcript", async () => {
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 8, end_time: 23, hook_type: "emotional", suggested_caption: "wow", confidence: 80 }] }),
  ]);

  await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  const prompt = promptTextFrom(client.calls[0]);
  for (const phrase of [
    "Standalone completeness",
    "Strong opening",
    "Meaningful payoff",
    "Variety",
    "Natural endings",
    "never invent or imply an outcome",
    "TRANSCRIPT (sentences, start-end timestamps in seconds):",
  ]) {
    assert.ok(prompt.includes(phrase), `prompt must include "${phrase}"`);
  }
});

test("selectSegments prompt: the music path is byte-identical to the pre-existing prompt format", async () => {
  const audioAnalysis = {
    windows: [
      { start: 0, end: 3, energy: 0.5, label: "verse" as const },
      { start: 3, end: 6, energy: 0.9, label: "chorus" as const },
    ],
  };
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0, end_time: 15, hook_type: "chorus", suggested_caption: "drop", confidence: 80 }] }),
  ]);

  await selectSegments("music", null, audioAnalysis, 30, client);

  const prompt = promptTextFrom(client.calls[0]);
  const expected = `You select the 3-5 best short-form-video moments from the source below.
Return ONLY valid JSON matching this shape, nothing else:
{"segments":[{"start_time":number,"end_time":number,"hook_type":"surprising_claim"|"question"|"contrarian"|"result_number"|"emotional"|"chorus"|"bridge","suggested_caption":string,"confidence":0-100}]}

Rules:
- The source is only 30.0 seconds long — every segment's end_time must be <= 30.0. Do not propose anything past that.
- Each segment must be self-contained and make sense with no other context.
- Clip length must be between 12 and 30 seconds.
- Prefer moments with a strong opening line/beat within the first 2 seconds (the "hook").
- suggested_caption is a short, punchy on-screen caption a creator would post with the clip — not a summary.
- confidence reflects how likely this specific moment is to stop a scroll, 0-100.
- Order segments by confidence, descending.
- For music, only use hook_type "chorus" or "bridge". For spoken content, use the other five types.

AUDIO ENERGY WINDOWS (music track, no lyrics transcript provided):
[0.0s-3.0s] energy=0.50 label=verse
[3.0s-6.0s] energy=0.90 label=chorus`;

  assert.equal(prompt, expected, "the music prompt must not change a single character from before Step 2");
});

test("selectSegments: a model timestamp within tolerance is snapped exactly onto the nearest sentence boundary", async () => {
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 8.3, end_time: 22.7, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(result.start_time, 8, "0.3s off S3's start (tolerance min(1.5, 0.25*15)=1.5) must snap exactly onto it");
  assert.equal(result.end_time, 23, "0.3s off S3's end must snap exactly onto it");
});

test("selectSegments: a model timestamp exactly at the snapping tolerance distance still snaps (inclusive <=)", async () => {
  // S3 is 15.0s long, so its tolerance is min(1.5, 0.25*15=3.75) = 1.5 exactly.
  // 6.5 is exactly 1.5s from S3's start (8.0), and 21.5 is exactly 1.5s from
  // S3's end (23.0) — both distances equal to the tolerance, not merely
  // inside it. snapToNearestSentenceBoundary uses an inclusive `<=`
  // comparison (deliberately, for consistency with Step 1's inclusive `>=`
  // overlap threshold), so both must snap rather than being left alone.
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 6.5, end_time: 21.5, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(result.start_time, 8, "exactly at tolerance distance from S3's start — inclusive <= must still snap");
  assert.equal(result.end_time, 23, "exactly at tolerance distance from S3's end — inclusive <= must still snap");
});

test("selectSegments: a model timestamp outside tolerance is left exactly as returned", async () => {
  // S2 ends at 7.0; tolerance there is min(1.5, 0.25*3.8)=0.95. 5.0 away is
  // nowhere near any boundary (S1 end 3.0, S2 end 7.0, S3 end 23.0).
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0, end_time: 12, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(result.start_time, 0, "exactly on S1's start already — unaffected either way");
  assert.equal(result.end_time, 12, "12s is far outside tolerance of every sentence end — must be left unchanged");
});

test("selectSegments: a segment that is duration-valid before snapping becomes invalid after snapping, so the snap is rejected and the original is returned", async () => {
  // A single sentence spanning [2.0, 12.0] (10.0s long, tolerance =
  // min(1.5, 0.25*10) = 1.5).
  const transcript = makeTranscript([makeWord("Filler", 2000, 7000), makeWord("sentence.", 7000, 12000)]);

  // Raw segment [1.0, 13.0]: 12.0s duration — valid BEFORE snapping (passes
  // the new duration check below), and each endpoint is exactly 1.0s from
  // the sentence's start/end (within the 1.5s tolerance), so both WOULD
  // independently snap.
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 1.0, end_time: 13.0, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", transcript, null, 20, client);

  // Snapping to [2.0, 12.0] would produce a 10.0s clip, below
  // MIN_CLIP_SECONDS — the whole snap must be rejected, leaving the
  // model's original (already duration-valid) timestamps untouched.
  assert.equal(result.start_time, 1.0, "snap rejected as a whole — original start_time preserved");
  assert.equal(result.end_time, 13.0, "snap rejected as a whole — original end_time preserved");
  assert.equal(result.end_time - result.start_time, 12, "the untouched original duration remains valid");
});

test("selectSegments: an already sentence-aligned segment shorter than MIN_CLIP_SECONDS is rejected, not silently stretched", async () => {
  // Aligned exactly to S1's start (0) and S2's end (7) — snapping is a
  // pure no-op here, so this exercises the NEW pre-snap duration check,
  // not the post-snap revalidation covered by the test above.
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0, end_time: 7, hook_type: "emotional", suggested_caption: "too short", confidence: 80 }] }),
  ]);

  const result = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(client.calls.length, 2, "rejected on both attempts, since the fake client returns the same too-short segment each time");
  assert.equal(result.length, 3, "falls through to the unchanged heuristic fallback rather than returning a sub-12s clip");
  for (const segment of result) {
    assert.equal(segment.suggested_caption, "worth the watch", "this is the fallback's own fixed caption, not the rejected 7s segment");
  }
});

test("selectSegments: an already sentence-aligned segment longer than MAX_CLIP_SECONDS is rejected, not silently shortened", async () => {
  const transcript = makeTranscript([makeWord("Start.", 0, 2000), makeWord("End.", 49000, 50000)]);
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0, end_time: 50, hook_type: "emotional", suggested_caption: "too long", confidence: 80 }] }),
  ]);

  const result = await selectSegments("spoken", transcript, null, 50, client);

  assert.equal(client.calls.length, 2, "rejected on both attempts");
  assert.equal(result.length, 3, "falls through to the unchanged heuristic fallback rather than returning a 50s clip");
  for (const segment of result) {
    assert.equal(segment.suggested_caption, "worth the watch");
  }
});

test("selectSegments: a segment at exactly MIN_CLIP_SECONDS (12s) is valid and returned unchanged", async () => {
  const transcript = makeTranscript([makeWord("One.", 0, 12000)]); // single sentence [0, 12]
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0, end_time: 12, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", transcript, null, 12, client);

  assert.equal(result.start_time, 0);
  assert.equal(result.end_time, 12, "exactly 12s must be accepted — the >= bound is inclusive, not exclusive");
});

test("selectSegments: a segment at exactly MAX_CLIP_SECONDS (45s) is valid and returned unchanged", async () => {
  const transcript = makeTranscript([makeWord("One.", 0, 45000)]); // single sentence [0, 45]
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0, end_time: 45, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", transcript, null, 45, client);

  assert.equal(result.start_time, 0);
  assert.equal(result.end_time, 45, "exactly 45s must be accepted — the <= bound is inclusive, not exclusive");
});

test("selectSegments: a response containing a negative start_time is rejected, never returned, falling through to the heuristic fallback", async () => {
  // start_time is already constrained to be nonnegative by segmentSchema
  // (z.number().nonnegative()), so this particular value fails the whole
  // response's zod parse before even reaching the explicit start_time >= 0
  // check added to the raw-response filter (that check is defense-in-depth
  // at that layer, for a response shape the schema doesn't happen to
  // catch) — either way, the end-to-end contract under test here is the
  // same: a negative start_time is never returned from selectSegments().
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: -1, end_time: 20, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const result = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(client.calls.length, 2, "rejected on both attempts");
  assert.equal(result.length, 3, "falls through to the unchanged heuristic fallback rather than returning a negative-start segment");
  for (const segment of result) {
    assert.ok(segment.start_time >= 0, "no returned segment may have a negative start_time");
  }
});

test("selectSegments: independent per-endpoint snapping can land the clip on a different combination of sentences than the model's raw numbers suggested (documented, bounded limitation — not fixed here)", async () => {
  // Five short sentences with closely-bunched boundaries (S2 starts before
  // S1 even ends; S4 ends well before a human would expect from the raw
  // numbers below). This is the adversarial shape identified in review:
  // bunched boundaries make "nearest" ambiguous between neighbors.
  const transcript = makeTranscript([
    makeWord("S1.", 0, 4000),
    makeWord("S2.", 3900, 8000),
    makeWord("S3.", 8300, 12000),
    makeWord("S4.", 12300, 16000),
    makeWord("S5, a much longer sentence that keeps going for quite a while here.", 16400, 36000),
  ]);

  // The model's raw numbers suggest an intent to span from partway into S2
  // through partway into S5 (a 12.7s selection) — but start_time snaps to
  // S2's start (nearest, 0.1s away) and end_time snaps to S4's end
  // (nearest, 0.5s away; S5's end at 36.0 is far outside tolerance), not
  // to S5 as the raw end_time=16.5 might suggest was intended.
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 3.8, end_time: 16.5, hook_type: "emotional", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("spoken", transcript, null, 40, client);

  // This is the documented, bounded behavior (see the comment above
  // snapToNearestSentenceBoundary), not a crash or an invalid result: the
  // returned clip is still sentence-aligned and duration-valid, it just
  // covers S2-S4 rather than whatever exact span the model's raw numbers
  // suggested. Each endpoint moved by at most ABSOLUTE_SNAP_TOLERANCE_SECONDS
  // (1.5s), so the corrected interval is adjacent to, not unboundedly
  // different from, the model's intended selection — but it CAN be a
  // different combination of sentences, which is the point of this test.
  assert.equal(result.start_time, 3.9, "snapped to S2's start, not the raw 3.8");
  assert.equal(result.end_time, 16, "snapped to S4's end, not the raw 16.5 (S5's end at 36.0 is far outside tolerance)");
  assert.ok(result.end_time - result.start_time >= MIN_CLIP_SECONDS, "the resulting clip is still duration-valid despite covering a different sentence range");
});

test("selectSegments: music segments are never run through sentence-boundary snapping", async () => {
  const client = makeFakeClient([
    JSON.stringify({ segments: [{ start_time: 0.3, end_time: 14.7, hook_type: "chorus", suggested_caption: "x", confidence: 80 }] }),
  ]);

  const [result] = await selectSegments("music", null, { windows: [{ start: 0, end: 15, energy: 0.8, label: "chorus" }] }, 30, client);

  assert.equal(result.start_time, 0.3, "no sentence list exists for music — nothing to snap against, values pass through untouched");
  assert.equal(result.end_time, 14.7);
});

test("selectSegments: invalid timestamps in the model's response are filtered out before snapping or returning", async () => {
  const client = makeFakeClient([
    JSON.stringify({
      segments: [
        { start_time: 10, end_time: 8, hook_type: "emotional", suggested_caption: "invalid", confidence: 80 }, // end <= start
        { start_time: 8, end_time: 23, hook_type: "emotional", suggested_caption: "valid", confidence: 80 },
      ],
    }),
  ]);

  const result = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(result.length, 1);
  assert.equal(result[0].suggested_caption, "valid");
});

test("selectSegments: the existing schema successfully parses a well-formed response", async () => {
  const client = makeFakeClient([
    JSON.stringify({
      segments: [{ start_time: 8, end_time: 23, hook_type: "surprising_claim", suggested_caption: "caption", confidence: 42 }],
    }),
  ]);

  const result = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(result.length, 1);
  assert.equal(result[0].hook_type, "surprising_claim");
  assert.equal(result[0].confidence, 42);
});

test("selectSegments: retry behavior is unchanged — a first-attempt failure is retried once, and the second attempt's result is used", async () => {
  const client = makeFakeClient([
    "__THROW__",
    JSON.stringify({ segments: [{ start_time: 8, end_time: 23, hook_type: "emotional", suggested_caption: "second try", confidence: 80 }] }),
  ]);

  const result = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(client.calls.length, 2, "exactly one retry — the existing two-attempt loop must be unchanged");
  assert.equal(result[0].suggested_caption, "second try");
});

test("selectSegments: two failed attempts fall through to the unchanged heuristic fallback", async () => {
  const client = makeFakeClient(["__THROW__", "not valid json at all"]);

  const result = await selectSegments("spoken", spokenFixtureTranscript(), null, 23, client);

  assert.equal(client.calls.length, 2);
  // The spoken heuristic fallback's own, unchanged signature: 3 equal-time
  // chunks with its hardcoded caption/hook_type/confidence.
  assert.equal(result.length, 3);
  for (const segment of result) {
    assert.equal(segment.suggested_caption, "worth the watch");
    assert.equal(segment.hook_type, "result_number");
    assert.equal(segment.confidence, 55);
  }
});

test("selectSegments + dedupeOverlappingSegments: Step 1's overlap filter still removes conflicting segments after boundary correction runs", async () => {
  const client = makeFakeClient([
    JSON.stringify({
      segments: [
        { start_time: 0, end_time: 20, hook_type: "emotional", suggested_caption: "a", confidence: 60 },
        { start_time: 5, end_time: 22, hook_type: "question", suggested_caption: "b", confidence: 90 },
      ],
    }),
  ]);

  const result = await selectSegments("spoken", makeTranscript([makeWord("filler.", 0, 100)]), null, 22, client);

  assert.equal(result.length, 2, "selectSegments itself does not dedupe — that remains Step 1's job, called separately in jobRunner.ts");

  const deduped = dedupeOverlappingSegments(result);

  assert.ok(deduped.length < 2, "the overlap filter must still catch these two heavily-overlapping segments after selectSegments() returns");
});
