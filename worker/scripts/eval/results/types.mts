// Shared types for Step 3A evaluation results. See ../README.md and
// ../rubric.md for the rubric these scores correspond to, and validate.mts
// for the validation helper that enforces the rules described here.

// An integer 1-5, per the rubric's 1/3/5-anchored scale. TypeScript's
// literal union only constrains the compile-time shape — validate.mts
// still re-checks this at runtime, since any JSON loaded from disk is
// effectively `unknown` until checked.
export type Score = 1 | 2 | 3 | 4 | 5;

// The 6 criteria that are scored per individual segment. Variety is
// deliberately NOT here — it's a property of a run's whole set of
// segments (how different they are from each other), not of any one
// segment in isolation, so it lives on RunEvaluation instead.
export interface SegmentScores {
  hook: Score;
  selfContainedness: Score;
  payoff: Score;
  naturalEnding: Score;
  // Renamed from the earlier "timestamp accuracy": whether the selected
  // span, judged against the TRANSCRIPT's own word/sentence timestamps,
  // captures a complete thought without missing or unnecessary content.
  // Fully scorable from text + timestamps alone — see rubric.md.
  textBoundaryAccuracy: Score;
  creatorUsefulness: Score;
  // Reserved for a later step, once real rendered audio exists to
  // actually listen to (see rubric.md's "Audio-boundary accuracy
  // (reserved)" section). Always absent in every Step 3A result — never
  // populate this field from a synthetic fixture.
  audioBoundaryAccuracy?: Score;
}

// Which selection approach produced this run's segments.
//   old                     — pre-Step-2 prompt + flat per-word transcript, no grouping, no snapping
//   new                     — current Step-2 prompt + sentence-grouped transcript + snapping (production as of commit 06cc5ed)
//   new-prompt-no-snap      — identical to "new" except the snap-correction step is skipped (isolates snapping's effect)
//   old-prompt-new-transcript — optional further ablation: old prompt instructions + new sentence-grouped transcript + snapping (isolates transcript formatting's effect independent of prompt wording). Not built unless the simpler ablation above shows something worth digging into.
export type PromptVariant = "old" | "new" | "new-prompt-no-snap" | "old-prompt-new-transcript";

export interface SelectionConfig {
  contentType: "spoken";
  maxEndSeconds: number;
  snappingEnabled: boolean;
}

// One row per individual segment selected within a run.
export interface SegmentEvaluation {
  transcriptId: string; // matches a Fixture.id from ../fixtures
  promptVariant: PromptVariant;
  runNumber: number; // which repeated sample this is, for the same (transcriptId, promptVariant) pair
  segmentIndex: number; // position within this run's returned segments (0-based)
  selectedText: string; // the transcript text actually spanned by startTime/endTime
  startTime: number; // seconds
  endTime: number; // seconds
  hookType: string;
  suggestedCaption: string;
  confidence: number;
  scores: SegmentScores;
  notes: string;
  evaluatorId?: string;
  // ISO-8601 UTC date-time, exactly as produced by `new Date().toISOString()`
  // (e.g. "2026-11-23T00:00:00.000Z") — validate.mts enforces this exact
  // format, not just "any string Date.parse() happens to accept".
  evaluatedAt: string;
}

// One row per run (one full selection attempt producing a set of 3-5
// segments, or the heuristic fallback's output).
export interface RunEvaluation {
  transcriptId: string;
  promptVariant: PromptVariant;
  runNumber: number;
  segmentCount: number;
  // Scored once across this run's whole segment set — null whenever
  // usedFallback is true, since the fallback isn't a judgment call to
  // score (see validate.mts's semantic check enforcing this pairing).
  varietyScore: Score | null;
  varietyNotes: string;

  // --- reproducibility metadata ---
  // Resolved model identifier at call time. Optional: a human recording
  // results by hand after the fact may not always have reliably captured
  // this.
  modelIdentifier?: string;
  // Hash of the exact prompt text sent for this run. This is the
  // authoritative reproducibility anchor, since the prompts themselves
  // are inline template literals in selectSegments.ts with no version
  // number of their own.
  promptHash?: string;
  // The Fixture.version of the fixture used for this run, so results
  // stay attributable to exact fixture content even after a fixture file
  // is later edited.
  fixtureVersion?: string;
  selectionConfig: SelectionConfig;
  // How many of selectSegments()'s 2 allowed attempts were actually used
  // for this run. NOTE: this means N runs do not correspond to exactly N
  // API requests — each run can cost 1 or 2 real requests depending on
  // whether the first attempt succeeded, before either returning or
  // falling through to the fallback (0 further requests).
  attemptsUsed: 1 | 2;
  // true if heuristicFallback() produced this run's segments rather than
  // the model. Fallback output does not depend on promptVariant at all —
  // see isComparable()/filterComparableRuns() in validate.mts, which
  // exclude fallback runs from any prompt-quality comparison.
  usedFallback: boolean;
  evaluatorId?: string;
  // ISO-8601 UTC date-time, exactly as produced by `new Date().toISOString()`
  // (e.g. "2026-11-23T00:00:00.000Z") — validate.mts enforces this exact
  // format, not just "any string Date.parse() happens to accept".
  evaluatedAt: string;
}

export interface EvaluationResultsFile {
  segmentEvaluations: SegmentEvaluation[];
  runEvaluations: RunEvaluation[];
}
