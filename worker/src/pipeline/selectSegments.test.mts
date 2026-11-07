// Tests for dedupeOverlappingSegments() — the deterministic overlap filter
// added as Step 1 of the video-quality improvement plan. Imported directly
// from the real production module; no fakes needed, since this function
// (unlike selectSegments() itself) is pure — no Anthropic client, no
// network, no filesystem.
//
// Tests assert on BEHAVIOR (the pairwise overlap guarantee, which
// survivors remain, chronological ordering of the output) rather than on
// implementation details like sort-comparator internals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeOverlappingSegments, OVERLAP_RATIO_THRESHOLD } from "./selectSegments.js";
import type { SelectedSegment } from "../lib/database.types.js";

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
