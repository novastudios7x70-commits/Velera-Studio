# Spoken-video selection quality evaluation (Step 3A)

This directory is the evaluation **foundation** for comparing the old
(pre-Step-2) and current (Step-2) spoken-video segment-selection
approaches on actual content quality, not just code correctness. It is
scaffolding — fixtures, a scoring rubric, and a results schema with a
validator — not an evaluation that has actually been run yet.

**What this is not, as of Step 3A:**

- No Anthropic (or any paid API) calls happen anywhere in this directory.
- No real comparison data has been collected — `results/sample-result.json`
  is intentionally empty.
- No production file is imported, modified, or executed by anything here.
  `worker/src/pipeline/selectSegments.ts` and `worker/src/jobRunner.ts` are
  untouched.
- Nothing here is part of the production build: like the sibling
  `worker/scripts/selectSegments.eval.mts`, this whole directory lives
  outside `worker/tsconfig.json`'s `"include": ["src"]`, so it's excluded
  from both `tsc` and `npm run build` with no config changes.

## Directory structure

```
eval/
  README.md            — this file
  rubric.md             — the 7-criterion scoring rubric, with 1/3/5 anchors
  fixtures/
    types.mts            — Fixture / FixtureSentence types
    <category>.clean.mts / <category>.noisy.mts  — 10 fixtures total
    index.mts            — exports all 10 fixtures as FIXTURES / FIXTURES_BY_ID
  results/
    types.mts            — SegmentEvaluation / RunEvaluation / EvaluationResultsFile
    validate.mts          — validateResultsFile() + fallback-exclusion helpers
    sample-result.json    — empty, valid results file (no fabricated scores)
```

## Fixtures

Ten fixtures across five categories — interview, tutorial, comedy, emotional,
vlog — each with a `clean` and a `noisy` variant (`fixtures/<category>.<variant>.mts`).
The noisy variants of the same underlying story inject filler words, false
starts, run-on/comma-spliced sentences, imperfect or missing punctuation,
and natural pauses, so selection quality can be checked against realistic
transcription noise, not just hand-written clean text.

Each fixture has a `designNotes` field — orientation for whoever scores its
output (what it's meant to stress-test, roughly where a plausible good clip
might live). This is **not** a ground-truth answer key; an evaluator still
has to judge quality, not check a box against this text.

Each fixture also carries a `version` string, bumped by hand whenever its
content changes, so a `RunEvaluation.fixtureVersion` can point at exactly
what was used even after a fixture file is later edited.

Import `FIXTURES` or `FIXTURES_BY_ID` from `fixtures/index.mts` to get all
ten at once.

## Rubric

See `rubric.md` for the full 7-criterion rubric. In brief: Hook,
Self-containedness, Payoff, Natural ending, Text-boundary accuracy, and
Creator usefulness are scored per segment; Variety is scored once per run,
across that run's whole set of segments — it's a property of how the
segments relate to each other, not of any one segment.

`rubric.md` also explains why "Timestamp accuracy" became "Text-boundary
accuracy," and why a separate "Audio-boundary accuracy" is reserved in the
schema but deliberately *not* scored here: judging real audio requires a
real rendered clip to listen to, which synthetic fixtures cannot provide.

## Results format and validation

`results/types.mts` defines two record types:

- `SegmentEvaluation` — one row per selected segment within a run (the 6
  per-segment scores, the segment's text/timestamps, reproducibility
  metadata is on the run, not duplicated here).
- `RunEvaluation` — one row per run (one call through the selection logic
  producing a set of 3-5 segments, or the fallback's output): the Variety
  score, and reproducibility metadata (`modelIdentifier`, `promptHash`,
  `fixtureVersion`, `selectionConfig`, `attemptsUsed`, `usedFallback`).

`results/validate.mts` exports `validateResultsFile(data: unknown):
{ valid: boolean; errors: string[] }`, plus the individual
`validateSegmentEvaluation()` / `validateRunEvaluation()` functions it's
built from. Every score field is checked to be an integer from 1 through 5
(not just "a number in range" — `3.5` and `"3"` are both rejected),
`confidence` must be an integer 0-100 (matching production's
`z.number().int()` exactly, not just "any finite number in range"),
`hookType` must be one of the 7 production enum values, `evaluatedAt`
must be a real ISO-8601 UTC date-time (not just a non-empty string), and
every required field is checked for presence and type — every failure
names the exact field and the value that failed.

Beyond individual records, `validateResultsFile()` also checks relationships
across the whole file:

- `varietyScore` must be `null` when `usedFallback` is `true`, and a valid
  1-5 integer otherwise — a fallback run has no model judgment to score
  variety across.
- No two `RunEvaluation` entries may share the same `(transcriptId,
  promptVariant, runNumber)` key, even if every other field (including
  `usedFallback`) is identical or contradictory — a duplicated key makes
  "which run does this segment belong to" ambiguous.
- `segmentIndex` must be unique within a run's segments (the same index
  is fine across different runs).
- Every `SegmentEvaluation`'s run key must match some `RunEvaluation`
  (no orphan segments).
- Each run's declared `segmentCount` must equal the number of
  `SegmentEvaluation` records actually sharing its key (0 is valid when
  there are none) — skipped only for a run whose key is itself duplicated,
  since counting against an ambiguous key is meaningless once that's
  already been flagged.

```ts
import { validateResultsFile } from "./results/validate.mjs";
import rawResults from "./results/sample-result.json" with { type: "json" };

const { valid, errors } = validateResultsFile(rawResults);
if (!valid) {
  console.error(errors.join("\n"));
}
```

### Fallback runs are excluded from comparisons, not just labeled

A run that fell through to `heuristicFallback()` (two failed/unparseable
model attempts) produced output that doesn't depend on `promptVariant` at
all, so it can't say anything about which prompt is better. Rather than
relying on everyone remembering to check `usedFallback` by hand,
`results/validate.mts` also exports:

- `isComparable(run)` — `true` iff a single run object's own `usedFallback`
  is `false`. This can't detect a duplicated key by itself (that's a
  property of a whole list, not of one run in isolation) — see
  `filterComparableRuns` below for the guarantee that actually matters.
- `filterComparableRuns(runs)` / `filterComparableSegments(segments, runs)`
  / `filterComparable(file)` — drop every fallback run (and its segments)
  from a results file before any prompt-quality comparison is computed.

Both `filterComparableRuns` and `filterComparableSegments` exclude more
than just fallback records, and they apply the **identical** rule: a run
or segment is only ever returned as comparable when its `(transcriptId,
promptVariant, runNumber)` key matches **exactly one** run, and that run's
`usedFallback` is `false`. A key that matches no run at all (an orphan),
or matches more than one run (an ambiguous, duplicated key), is excluded
from both — its fallback status is unknown, and unknown status never
defaults to comparable, whether that's a segment or the run record
itself. Because both functions apply the same rule, `filterComparable()`'s
two returned arrays always agree: a run never appears in `runEvaluations`
with none of its segments eligible for `segmentEvaluations`, or vice
versa. These functions don't throw on that kind of malformed input; they narrow silently to what can be
positively confirmed. Run `validateResultsFile()` first if you need to
know *why* something was excluded (missing run, duplicated run, or a
genuine fallback) rather than just that it was.

## The comparison this is building toward (Step 3B, not yet run)

- **Primary comparison:** `old` (pre-Step-2 prompt + flat per-word
  transcript, no grouping, no snapping) vs. `new` (current Step-2 prompt +
  sentence-grouped transcript + snapping) — two full, bundled approaches,
  compared as wholes. This is the only comparison that gets to say
  anything about "Step 2" overall.
- **Optional ablation:** `new-prompt-no-snap` — identical to `new` except
  the snap-correction step is skipped. Because it differs from `new` in
  exactly one dimension, *that specific pairwise comparison* is the only
  one that can isolate snapping's own contribution. Comparing
  `new-prompt-no-snap` to `old` would not isolate anything — multiple
  things still differ — and must not be used to attribute cause.
- **Further optional ablation (not built unless the first one shows
  something worth investigating):** `old-prompt-new-transcript` — old
  prompt wording fed the new sentence-grouped transcript, with snapping
  applied. Isolates transcript formatting's effect independent of the new
  instructional text.

Running any of this against the real model is a separate, explicitly
authorized step. A planning note for whoever authorizes it: a "run" here
means one call into the selection logic, which can cost **1 or 2** real API
requests internally (the existing two-attempt retry loop) before either
succeeding or falling to the fallback. 10 fixtures × 2 primary variants × 3
repeats = 60 *runs* is therefore **60-120 actual API requests**, not a
fixed 60 — that range should be what's quoted when asking for that
authorization, not a single number.

No file in this directory calls Anthropic, renders audio, or touches
customer data. Building the actual runner that does any of that is Step
3B.
