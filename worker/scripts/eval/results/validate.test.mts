// Regression tests for results/validate.mts, covering the findings from
// the Step 3A read-only review. Run directly (this directory is outside
// the worker package's own "npm test" glob, same as it's outside the
// build — see ../README.md):
//
//   node --import tsx --test worker/scripts/eval/results/validate.test.mts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateResultsFile,
  validateSegmentEvaluation,
  validateRunEvaluation,
  isComparable,
  filterComparableRuns,
  filterComparableSegments,
  filterComparable,
} from "./validate.mjs";
import type { RunEvaluation, SegmentEvaluation } from "./types.mjs";

function makeRun(overrides: Partial<RunEvaluation> = {}): RunEvaluation {
  return {
    transcriptId: "interview-clean",
    promptVariant: "new",
    runNumber: 1,
    segmentCount: 1,
    varietyScore: 3,
    varietyNotes: "",
    selectionConfig: { contentType: "spoken", maxEndSeconds: 30, snappingEnabled: true },
    attemptsUsed: 1,
    usedFallback: false,
    evaluatedAt: "2026-11-23T00:00:00.000Z",
    ...overrides,
  };
}

function makeSegment(overrides: Partial<SegmentEvaluation> = {}): SegmentEvaluation {
  return {
    transcriptId: "interview-clean",
    promptVariant: "new",
    runNumber: 1,
    segmentIndex: 0,
    selectedText: "x",
    startTime: 0,
    endTime: 12,
    hookType: "emotional",
    suggestedCaption: "x",
    confidence: 80,
    scores: {
      hook: 3,
      selfContainedness: 3,
      payoff: 3,
      naturalEnding: 3,
      textBoundaryAccuracy: 3,
      creatorUsefulness: 3,
    },
    notes: "",
    evaluatedAt: "2026-11-23T00:00:00.000Z",
    ...overrides,
  };
}

// --- baseline behavior (preserved from before this fix) ---

test("validateResultsFile: an empty results file is valid", () => {
  assert.deepEqual(validateResultsFile({ segmentEvaluations: [], runEvaluations: [] }), { valid: true, errors: [] });
});

test("validateResultsFile: a well-formed run with its one matching segment is valid", () => {
  const result = validateResultsFile({ segmentEvaluations: [makeSegment()], runEvaluations: [makeRun()] });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("validateRunEvaluation: varietyScore must be null when usedFallback is true", () => {
  const errors = validateRunEvaluation(makeRun({ usedFallback: true, varietyScore: 4 }));
  assert.ok(errors.some((e) => e.includes("varietyScore must be null")), errors.join("\n"));
});

test("validateRunEvaluation: varietyScore must be a valid score when usedFallback is false", () => {
  const errors = validateRunEvaluation(makeRun({ usedFallback: false, varietyScore: null }));
  assert.ok(errors.some((e) => e.includes("varietyScore is required")), errors.join("\n"));
});

// --- Finding 1: segmentCount cross-check ---

test("validateResultsFile: a run whose segmentCount is too HIGH is rejected with the expected/actual counts named", () => {
  const result = validateResultsFile({ segmentEvaluations: [makeSegment()], runEvaluations: [makeRun({ segmentCount: 5 })] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("declares segmentCount=5") && e.includes("1 associated")), result.errors.join("\n"));
});

test("validateResultsFile: a run whose segmentCount is too LOW is rejected with the expected/actual counts named", () => {
  const result = validateResultsFile({
    segmentEvaluations: [makeSegment({ segmentIndex: 0 }), makeSegment({ segmentIndex: 1 })],
    runEvaluations: [makeRun({ segmentCount: 1 })],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("declares segmentCount=1") && e.includes("2 associated")), result.errors.join("\n"));
});

test("validateResultsFile: a run with segmentCount=0 and zero matching segments is valid", () => {
  const result = validateResultsFile({ segmentEvaluations: [], runEvaluations: [makeRun({ segmentCount: 0 })] });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

// --- Finding 2: duplicate run keys ---

test("validateResultsFile: duplicate run keys with otherwise-identical data are rejected", () => {
  const run = makeRun();
  const result = validateResultsFile({ segmentEvaluations: [makeSegment()], runEvaluations: [run, { ...run }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate run key") && e.includes("transcriptId=interview-clean")), result.errors.join("\n"));
});

test("validateResultsFile: duplicate run keys with contradictory usedFallback values are rejected, not silently collapsed", () => {
  const result = validateResultsFile({
    segmentEvaluations: [makeSegment()],
    runEvaluations: [
      makeRun({ usedFallback: false, varietyScore: 3 }),
      makeRun({ usedFallback: true, varietyScore: null, varietyNotes: "fallback" }),
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate run key")), result.errors.join("\n"));
});

test("validateResultsFile: duplicate run keys with inconsistent (and wrong) segmentCount values report ONLY the duplicate-key problem, not a misleading segmentCount error", () => {
  // Only 1 real segment exists, but both duplicate runs declare wildly
  // different, both-wrong segmentCount values. Counting against an
  // ambiguous key is meaningless, so validateResultsFile must not also
  // emit a confusing "declares segmentCount=X but Y found" error here —
  // the duplicate-key error alone is the correct, non-misleading report.
  const result = validateResultsFile({
    segmentEvaluations: [makeSegment()],
    runEvaluations: [
      makeRun({ segmentCount: 5, usedFallback: false, varietyScore: 3 }),
      makeRun({ segmentCount: 99, usedFallback: true, varietyScore: null, varietyNotes: "fallback" }),
    ],
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1, `expected exactly one error (the duplicate-key error), got:\n${result.errors.join("\n")}`);
  assert.ok(result.errors[0]!.includes("duplicate run key"));
  assert.ok(!result.errors.some((e) => e.includes("segmentCount")), "no segmentCount error should be reported for an already-ambiguous run key");
});

// --- Finding 3: duplicate segmentIndex within a run ---

test("validateResultsFile: duplicate segmentIndex within the same run is rejected", () => {
  const result = validateResultsFile({
    segmentEvaluations: [makeSegment({ segmentIndex: 0 }), makeSegment({ segmentIndex: 0 })],
    runEvaluations: [makeRun({ segmentCount: 2 })],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate segmentIndex=0")), result.errors.join("\n"));
});

test("validateResultsFile: the same segmentIndex in two DIFFERENT runs is accepted", () => {
  const result = validateResultsFile({
    segmentEvaluations: [
      makeSegment({ runNumber: 1, segmentIndex: 0 }),
      makeSegment({ runNumber: 2, segmentIndex: 0 }),
    ],
    runEvaluations: [makeRun({ runNumber: 1, segmentCount: 1 }), makeRun({ runNumber: 2, segmentCount: 1 })],
  });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

// --- Finding 4: safe comparison filtering ---

test("filterComparableSegments: an orphan segment (no matching run at all) is never returned as comparable", () => {
  const orphan = makeSegment({ transcriptId: "ghost-transcript" });
  assert.deepEqual(filterComparableSegments([orphan], []), []);
});

test("filterComparable: an orphan segment is never returned as comparable", () => {
  const orphan = makeSegment({ transcriptId: "ghost-transcript" });
  const result = filterComparable({ segmentEvaluations: [orphan], runEvaluations: [] });
  assert.deepEqual(result.segmentEvaluations, []);
});

test("filterComparableSegments: a segment whose run key is ambiguous (duplicated) is never comparable, even if every duplicate agrees it isn't a fallback", () => {
  const seg = makeSegment();
  const result = filterComparableSegments([seg], [makeRun({ usedFallback: false }), makeRun({ usedFallback: false })]);
  assert.deepEqual(result, [], "unknown/ambiguous fallback status must never default to comparable");
});

test("filterComparableSegments / filterComparable: a fallback run and all its segments are excluded", () => {
  const comparableSeg = makeSegment({ promptVariant: "new" });
  const fallbackSeg = makeSegment({ promptVariant: "old" });
  const runs = [
    makeRun({ promptVariant: "new", usedFallback: false, varietyScore: 3 }),
    makeRun({ promptVariant: "old", usedFallback: true, varietyScore: null, varietyNotes: "fallback" }),
  ];
  const result = filterComparable({ segmentEvaluations: [comparableSeg, fallbackSeg], runEvaluations: runs });
  assert.equal(result.runEvaluations.length, 1);
  assert.equal(result.runEvaluations[0]!.promptVariant, "new");
  assert.equal(result.segmentEvaluations.length, 1);
  assert.equal(result.segmentEvaluations[0]!.promptVariant, "new");
});

test("isComparable: true for a non-fallback run, false for a fallback run", () => {
  assert.equal(isComparable(makeRun({ usedFallback: false })), true);
  assert.equal(isComparable(makeRun({ usedFallback: true, varietyScore: null })), false);
});

// --- Fix 1: filterComparableRuns() must exclude ambiguous (duplicated) run keys, not just fallback runs ---

test("filterComparableRuns: two duplicate non-fallback runs sharing a key are BOTH excluded", () => {
  const runs = [makeRun({ usedFallback: false }), makeRun({ usedFallback: false })];
  assert.deepEqual(filterComparableRuns(runs), [], "a duplicated key is unsafe even when every duplicate agrees it isn't a fallback");
});

test("filterComparableRuns: one fallback and one non-fallback run sharing a key are BOTH excluded", () => {
  const runs = [
    makeRun({ usedFallback: false, varietyScore: 3 }),
    makeRun({ usedFallback: true, varietyScore: null, varietyNotes: "fallback" }),
  ];
  assert.deepEqual(filterComparableRuns(runs), [], "a duplicated key is unsafe regardless of which duplicate's usedFallback value you'd otherwise trust");
});

test("filterComparableRuns: a unique non-fallback run remains comparable", () => {
  const run = makeRun({ usedFallback: false });
  const result = filterComparableRuns([run]);
  assert.equal(result.length, 1);
  assert.equal(result[0], run);
});

test("filterComparableRuns: a unique run is excluded if it IS a fallback (baseline, unchanged by this fix)", () => {
  assert.deepEqual(filterComparableRuns([makeRun({ usedFallback: true, varietyScore: null })]), []);
});

test("filterComparable: no comparable run leaks into run-level aggregate data when its key is ambiguous, and runEvaluations/segmentEvaluations stay consistent", () => {
  const seg = makeSegment();
  const ambiguousRuns = [
    makeRun({ usedFallback: false, varietyScore: 3 }),
    makeRun({ usedFallback: true, varietyScore: null, varietyNotes: "fallback" }),
  ];
  const result = filterComparable({ segmentEvaluations: [seg], runEvaluations: ambiguousRuns });
  assert.deepEqual(result.runEvaluations, [], "an ambiguous run must never appear in run-level aggregate data");
  assert.deepEqual(result.segmentEvaluations, [], "its segments must stay excluded too — runs and segments must agree");
});

// --- Finding 5: integer confidence (0-100), matching production's z.number().int() ---

test("validateSegmentEvaluation: an integer confidence in range is accepted", () => {
  assert.deepEqual(validateSegmentEvaluation(makeSegment({ confidence: 87 })), []);
});

test("validateSegmentEvaluation: a decimal confidence is rejected", () => {
  const errors = validateSegmentEvaluation(makeSegment({ confidence: 87.3 }));
  assert.ok(errors.some((e) => e.includes("confidence") && e.includes("87.3")), errors.join("\n"));
});

test("validateSegmentEvaluation: a non-finite or out-of-range confidence is rejected", () => {
  assert.ok(validateSegmentEvaluation(makeSegment({ confidence: Infinity })).some((e) => e.includes("confidence")));
  assert.ok(validateSegmentEvaluation(makeSegment({ confidence: 101 })).some((e) => e.includes("confidence")));
  assert.ok(validateSegmentEvaluation(makeSegment({ confidence: -1 })).some((e) => e.includes("confidence")));
});

// --- Finding 6: evaluatedAt as a real, documented ISO-8601 date ---

test("validateSegmentEvaluation / validateRunEvaluation: a valid ISO-8601 UTC date is accepted", () => {
  assert.deepEqual(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-11-23T00:00:00.000Z" })), []);
  assert.deepEqual(validateRunEvaluation(makeRun({ evaluatedAt: "2026-11-23T00:00:00.000Z" })), []);
});

test("validateSegmentEvaluation / validateRunEvaluation: an invalid date string is rejected", () => {
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "not-a-real-date" })).some((e) => e.includes("evaluatedAt")));
  assert.ok(validateRunEvaluation(makeRun({ evaluatedAt: "not-a-real-date" })).some((e) => e.includes("evaluatedAt")));
});

test("validateSegmentEvaluation: a plausible but non-ISO date format is rejected (Date.parse() alone would accept it)", () => {
  const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: "November 23, 2026" }));
  assert.ok(errors.some((e) => e.includes("evaluatedAt")), errors.join("\n"));
});

test("validateSegmentEvaluation: an empty evaluatedAt string is rejected (required-field check preserved)", () => {
  const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: "" }));
  assert.ok(errors.some((e) => e.includes("evaluatedAt")), errors.join("\n"));
});

// --- Fix 2: isValidIsoDate() must do real calendar-component validation, not rely on Date.parse() ---

test("validateSegmentEvaluation: timestamps actually produced by new Date().toISOString() are always accepted", () => {
  // A handful of real, freshly-generated timestamps — not hand-typed —
  // to directly prove the documented producing function's own output is
  // never rejected.
  const samples = [new Date(), new Date(0), new Date(Date.UTC(2028, 1, 29)), new Date(Date.UTC(2000, 1, 29))];
  for (const d of samples) {
    const iso = d.toISOString();
    const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: iso })).filter((e) => e.includes("evaluatedAt"));
    assert.deepEqual(errors, [], `new Date().toISOString() output "${iso}" must always be accepted`);
  }
});

test("validateSegmentEvaluation: February 30 is rejected (Date.parse() would silently roll this over to March 2nd)", () => {
  const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-02-30T00:00:00.000Z" }));
  assert.ok(errors.some((e) => e.includes("evaluatedAt")), errors.join("\n"));
});

test("validateSegmentEvaluation: February 29 in a non-leap year is rejected", () => {
  // 2027 is not divisible by 4 — not a leap year.
  const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: "2027-02-29T00:00:00.000Z" }));
  assert.ok(errors.some((e) => e.includes("evaluatedAt")), errors.join("\n"));
});

test("validateSegmentEvaluation: February 29 in a leap year is accepted", () => {
  // 2028 is divisible by 4 and not by 100 — a leap year.
  assert.deepEqual(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2028-02-29T00:00:00.000Z" })), []);
});

test("validateSegmentEvaluation: the century leap-year rule is honored (divisible by 100 but not 400 is NOT a leap year)", () => {
  // 1900 is divisible by 100 but not by 400 — not a leap year, so Feb 29
  // doesn't exist that year, even though it's divisible by 4.
  const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: "1900-02-29T00:00:00.000Z" }));
  assert.ok(errors.some((e) => e.includes("evaluatedAt")), errors.join("\n"));
  // 2000 is divisible by 400 — a leap year.
  assert.deepEqual(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2000-02-29T00:00:00.000Z" })), []);
});

test("validateSegmentEvaluation: invalid month/day combinations are rejected", () => {
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-04-31T00:00:00.000Z" })).some((e) => e.includes("evaluatedAt")), "April has only 30 days");
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-13-01T00:00:00.000Z" })).some((e) => e.includes("evaluatedAt")), "month 13 doesn't exist");
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-00-15T00:00:00.000Z" })).some((e) => e.includes("evaluatedAt")), "month 0 doesn't exist");
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-06-00T00:00:00.000Z" })).some((e) => e.includes("evaluatedAt")), "day 0 doesn't exist");
  assert.deepEqual(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-04-30T00:00:00.000Z" })), [], "April 30th is valid");
});

test("validateSegmentEvaluation: invalid hours, minutes, and seconds are rejected", () => {
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-11-23T24:00:00.000Z" })).some((e) => e.includes("evaluatedAt")), "hour 24 doesn't exist");
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-11-23T00:60:00.000Z" })).some((e) => e.includes("evaluatedAt")), "minute 60 doesn't exist");
  assert.ok(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-11-23T00:00:60.000Z" })).some((e) => e.includes("evaluatedAt")), "second 60 doesn't exist");
  assert.deepEqual(validateSegmentEvaluation(makeSegment({ evaluatedAt: "2026-11-23T23:59:59.999Z" })), [], "23:59:59.999 is the last valid instant of the day");
});

test("validateSegmentEvaluation: malformed timestamps are rejected", () => {
  for (const malformed of ["2026/11/23T00:00:00.000Z", "2026-11-23 00:00:00.000Z", "2026-11-23T00:00:00.000", "20261123T000000Z", "2026-1-23T00:00:00.000Z"]) {
    const errors = validateSegmentEvaluation(makeSegment({ evaluatedAt: malformed }));
    assert.ok(errors.some((e) => e.includes("evaluatedAt")), `"${malformed}" should be rejected as malformed`);
  }
});

// --- Finding 7: hookType enum ---

const VALID_HOOK_TYPES = ["surprising_claim", "question", "contrarian", "result_number", "emotional", "chorus", "bridge"];

for (const hookType of VALID_HOOK_TYPES) {
  test(`validateSegmentEvaluation: hookType "${hookType}" is accepted`, () => {
    assert.deepEqual(validateSegmentEvaluation(makeSegment({ hookType })), []);
  });
}

test("validateSegmentEvaluation: an unknown hookType is rejected", () => {
  const errors = validateSegmentEvaluation(makeSegment({ hookType: "banana" }));
  assert.ok(errors.some((e) => e.includes("hookType") && e.includes("banana")), errors.join("\n"));
});
