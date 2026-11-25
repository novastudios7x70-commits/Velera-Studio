// Validation for Step 3A evaluation results. Anything loaded from a JSON
// file on disk is `unknown` until checked here — these functions never
// trust the shape of parsed JSON, and every error message names the exact
// field and the value that failed, so a malformed results file is easy to
// fix rather than just rejected.

import type { EvaluationResultsFile, PromptVariant, RunEvaluation, Score, SegmentEvaluation, SegmentScores } from "./types.mjs";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Requirement 1: scores must be integers 1-5, not just "a number in
// range" — 3.5 and "3" are both rejected here, not silently coerced.
function isScore(value: unknown): value is Score {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

// Mirrors production's confidence constraint exactly: selectSegments.ts's
// segmentSchema declares confidence as z.number().int().min(0).max(100).
// A decimal like 87.3 is not a value the real pipeline could ever produce,
// so it must not pass here either.
function isValidConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

// Requires the exact ISO-8601 UTC format `new Date().toISOString()`
// produces (e.g. "2026-11-23T00:00:00.000Z") — not just "anything
// Date.parse() happens to accept" (which would also take non-ISO strings
// like "November 23, 2026"). This is the one documented format for
// evaluatedAt everywhere in this schema — see types.mts.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // index 0 = January

// Deliberately does NOT use Date.parse() for the calendar-validity
// decision: V8's Date.parse silently normalizes some impossible dates
// instead of rejecting them (e.g. "2026-02-30" rolls over to March 2nd
// rather than returning NaN), which would make this check pass on a date
// that doesn't exist. Every field is validated explicitly instead —
// month range, then day range against that specific month/year (with
// real leap-year handling for February), then hour/minute/second range.
// The regex only checks digit shape; it never decides validity on its
// own.
function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]); // 1-12
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) return false;
  const daysInThisMonth = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  if (day < 1 || day > daysInThisMonth) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;

  return true;
}

const PROMPT_VARIANTS: readonly PromptVariant[] = ["old", "new", "new-prompt-no-snap", "old-prompt-new-transcript"];
function isPromptVariant(value: unknown): value is PromptVariant {
  return typeof value === "string" && (PROMPT_VARIANTS as readonly string[]).includes(value);
}

// Mirrors production's hook_type enum exactly: selectSegments.ts's
// segmentSchema declares this as a fixed 7-value z.enum(). An eval result
// claiming a hook type the real pipeline could never actually produce
// (e.g. a typo) must be rejected, not silently accepted as "any string".
const HOOK_TYPES: readonly string[] = [
  "surprising_claim",
  "question",
  "contrarian",
  "result_number",
  "emotional",
  "chorus",
  "bridge",
];
function isHookType(value: unknown): value is string {
  return typeof value === "string" && HOOK_TYPES.includes(value);
}

const SCORE_FIELDS: readonly (keyof SegmentScores)[] = [
  "hook",
  "selfContainedness",
  "payoff",
  "naturalEnding",
  "textBoundaryAccuracy",
  "creatorUsefulness",
];

// Shared key used everywhere a segment or run needs to be grouped/matched
// by the triple that identifies "which run is this": a plain string key
// (not a Set/Map of tuples, since JS doesn't hash tuples structurally) so
// Map/Set lookups work as intended.
function runKeyOf(x: { transcriptId: string; promptVariant: PromptVariant; runNumber: number }): string {
  return `${x.transcriptId}::${x.promptVariant}::${x.runNumber}`;
}
function describeKey(key: string): string {
  const [transcriptId, promptVariant, runNumber] = key.split("::");
  return `(transcriptId=${transcriptId}, promptVariant=${promptVariant}, runNumber=${runNumber})`;
}

/**
 * Validates one SegmentEvaluation record. Returns a list of human-readable
 * errors (empty means valid) — requirement 2 (required fields) and
 * requirement 1 (integer 1-5 scores) are both enforced here, with every
 * failure naming the field and the actual value received (requirement 3).
 */
export function validateSegmentEvaluation(value: unknown, path = "segmentEvaluation"): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null) {
    return [`${path} must be an object (got: ${JSON.stringify(value)})`];
  }
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.transcriptId)) errors.push(`${path}.transcriptId is required and must be a non-empty string (got: ${JSON.stringify(v.transcriptId)})`);
  if (!isPromptVariant(v.promptVariant)) {
    errors.push(`${path}.promptVariant must be one of ${PROMPT_VARIANTS.join(", ")} (got: ${JSON.stringify(v.promptVariant)})`);
  }
  if (!Number.isInteger(v.runNumber) || (v.runNumber as number) < 1) {
    errors.push(`${path}.runNumber is required and must be a positive integer (got: ${JSON.stringify(v.runNumber)})`);
  }
  if (!Number.isInteger(v.segmentIndex) || (v.segmentIndex as number) < 0) {
    errors.push(`${path}.segmentIndex is required and must be a non-negative integer (got: ${JSON.stringify(v.segmentIndex)})`);
  }
  if (!isNonEmptyString(v.selectedText)) errors.push(`${path}.selectedText is required and must be a non-empty string (got: ${JSON.stringify(v.selectedText)})`);
  if (!isFiniteNumber(v.startTime) || (v.startTime as number) < 0) {
    errors.push(`${path}.startTime is required and must be a non-negative finite number (got: ${JSON.stringify(v.startTime)})`);
  }
  if (!isFiniteNumber(v.endTime) || (isFiniteNumber(v.startTime) && (v.endTime as number) <= (v.startTime as number))) {
    errors.push(`${path}.endTime is required and must be a finite number greater than startTime (got: ${JSON.stringify(v.endTime)})`);
  }
  if (!isHookType(v.hookType)) {
    errors.push(`${path}.hookType must be one of ${HOOK_TYPES.join(", ")} (got: ${JSON.stringify(v.hookType)})`);
  }
  if (!isNonEmptyString(v.suggestedCaption)) errors.push(`${path}.suggestedCaption is required and must be a non-empty string (got: ${JSON.stringify(v.suggestedCaption)})`);
  if (!isValidConfidence(v.confidence)) {
    errors.push(`${path}.confidence is required and must be an integer from 0 through 100 (got: ${JSON.stringify(v.confidence)})`);
  }
  if (typeof v.notes !== "string") errors.push(`${path}.notes is required and must be a string (got: ${JSON.stringify(v.notes)})`);
  if (!isValidIsoDate(v.evaluatedAt)) {
    errors.push(`${path}.evaluatedAt is required and must be an ISO-8601 UTC date-time string, e.g. new Date().toISOString() (got: ${JSON.stringify(v.evaluatedAt)})`);
  }
  if (v.evaluatorId !== undefined && !isNonEmptyString(v.evaluatorId)) {
    errors.push(`${path}.evaluatorId, if present, must be a non-empty string (got: ${JSON.stringify(v.evaluatorId)})`);
  }

  if (typeof v.scores !== "object" || v.scores === null) {
    errors.push(`${path}.scores is required and must be an object (got: ${JSON.stringify(v.scores)})`);
  } else {
    const scores = v.scores as Record<string, unknown>;
    for (const field of SCORE_FIELDS) {
      if (!isScore(scores[field])) {
        errors.push(`${path}.scores.${field} must be an integer from 1 through 5 (got: ${JSON.stringify(scores[field])})`);
      }
    }
    // Requirement 6: audioBoundaryAccuracy stays optional. If a future
    // step does populate it, it must still be a valid score — but its
    // absence here is never an error.
    if (scores.audioBoundaryAccuracy !== undefined && !isScore(scores.audioBoundaryAccuracy)) {
      errors.push(`${path}.scores.audioBoundaryAccuracy, if present, must be an integer from 1 through 5 (got: ${JSON.stringify(scores.audioBoundaryAccuracy)})`);
    }
  }

  return errors;
}

/**
 * Validates one RunEvaluation record, including the semantic rule that
 * ties usedFallback to varietyScore (requirement 4: fallback runs must be
 * identifiable, and a fallback run has no model judgment to score).
 */
export function validateRunEvaluation(value: unknown, path = "runEvaluation"): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null) {
    return [`${path} must be an object (got: ${JSON.stringify(value)})`];
  }
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.transcriptId)) errors.push(`${path}.transcriptId is required and must be a non-empty string (got: ${JSON.stringify(v.transcriptId)})`);
  if (!isPromptVariant(v.promptVariant)) {
    errors.push(`${path}.promptVariant must be one of ${PROMPT_VARIANTS.join(", ")} (got: ${JSON.stringify(v.promptVariant)})`);
  }
  if (!Number.isInteger(v.runNumber) || (v.runNumber as number) < 1) {
    errors.push(`${path}.runNumber is required and must be a positive integer (got: ${JSON.stringify(v.runNumber)})`);
  }
  if (!Number.isInteger(v.segmentCount) || (v.segmentCount as number) < 0) {
    errors.push(`${path}.segmentCount is required and must be a non-negative integer (got: ${JSON.stringify(v.segmentCount)})`);
  }
  if (typeof v.usedFallback !== "boolean") {
    errors.push(`${path}.usedFallback is required and must be a boolean (got: ${JSON.stringify(v.usedFallback)})`);
  }

  // Requirement 7 (variety is run-level, not per-segment) shows up here as
  // a type-level fact — RunEvaluation.varietyScore is the only place a
  // Variety score can live — and requirement 4 shows up as this pairing
  // rule: a fallback run has no real selection to judge variety across.
  if (v.usedFallback === true) {
    if (v.varietyScore !== null) {
      errors.push(`${path}.varietyScore must be null when usedFallback is true — a fallback run has no model selection to score variety across (got: ${JSON.stringify(v.varietyScore)})`);
    }
  } else if (v.usedFallback === false) {
    if (!isScore(v.varietyScore)) {
      errors.push(`${path}.varietyScore is required and must be an integer from 1 through 5 when usedFallback is false (got: ${JSON.stringify(v.varietyScore)})`);
    }
  }
  if (typeof v.varietyNotes !== "string") errors.push(`${path}.varietyNotes is required and must be a string (got: ${JSON.stringify(v.varietyNotes)})`);

  if (v.modelIdentifier !== undefined && !isNonEmptyString(v.modelIdentifier)) {
    errors.push(`${path}.modelIdentifier, if present, must be a non-empty string (got: ${JSON.stringify(v.modelIdentifier)})`);
  }
  if (v.promptHash !== undefined && !isNonEmptyString(v.promptHash)) {
    errors.push(`${path}.promptHash, if present, must be a non-empty string (got: ${JSON.stringify(v.promptHash)})`);
  }
  if (v.fixtureVersion !== undefined && !isNonEmptyString(v.fixtureVersion)) {
    errors.push(`${path}.fixtureVersion, if present, must be a non-empty string (got: ${JSON.stringify(v.fixtureVersion)})`);
  }

  if (typeof v.selectionConfig !== "object" || v.selectionConfig === null) {
    errors.push(`${path}.selectionConfig is required and must be an object (got: ${JSON.stringify(v.selectionConfig)})`);
  } else {
    const cfg = v.selectionConfig as Record<string, unknown>;
    if (cfg.contentType !== "spoken") errors.push(`${path}.selectionConfig.contentType must be the literal string "spoken" (got: ${JSON.stringify(cfg.contentType)})`);
    if (!isFiniteNumber(cfg.maxEndSeconds) || (cfg.maxEndSeconds as number) <= 0) {
      errors.push(`${path}.selectionConfig.maxEndSeconds is required and must be a positive finite number (got: ${JSON.stringify(cfg.maxEndSeconds)})`);
    }
    if (typeof cfg.snappingEnabled !== "boolean") {
      errors.push(`${path}.selectionConfig.snappingEnabled is required and must be a boolean (got: ${JSON.stringify(cfg.snappingEnabled)})`);
    }
  }

  if (v.attemptsUsed !== 1 && v.attemptsUsed !== 2) {
    errors.push(`${path}.attemptsUsed is required and must be exactly 1 or 2 (got: ${JSON.stringify(v.attemptsUsed)})`);
  }
  if (!isValidIsoDate(v.evaluatedAt)) {
    errors.push(`${path}.evaluatedAt is required and must be an ISO-8601 UTC date-time string, e.g. new Date().toISOString() (got: ${JSON.stringify(v.evaluatedAt)})`);
  }
  if (v.evaluatorId !== undefined && !isNonEmptyString(v.evaluatorId)) {
    errors.push(`${path}.evaluatorId, if present, must be a non-empty string (got: ${JSON.stringify(v.evaluatorId)})`);
  }

  return errors;
}

/**
 * Validates a whole results file in two passes:
 *
 * 1. Every record individually (validateSegmentEvaluation /
 *    validateRunEvaluation above). If anything fails here, the
 *    whole-file checks below are skipped — they assume every individual
 *    record already has the right shape and types.
 *
 * 2. Whole-file relational checks, once every record is individually
 *    valid:
 *    - duplicate run keys: no two RunEvaluation entries may share the
 *      same (transcriptId, promptVariant, runNumber), even if every
 *      other field is identical, and even if usedFallback differs — a
 *      duplicated key makes "which run does this segment belong to"
 *      ambiguous, which is unsafe to resolve silently.
 *    - duplicate segmentIndex: within one run's segments (same run key),
 *      segmentIndex must be unique. The same index is fine across
 *      different runs.
 *    - orphan segments: every SegmentEvaluation's run key must match at
 *      least one RunEvaluation.
 *    - segmentCount: for every run whose key is NOT duplicated, its
 *      declared segmentCount must equal the number of SegmentEvaluation
 *      entries sharing that key (0 is valid when there are none). This
 *      check is skipped for a duplicated run key, since counting against
 *      an ambiguous key would itself be meaningless — the duplicate-key
 *      error already makes that record invalid.
 */
export function validateResultsFile(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null) {
    return { valid: false, errors: [`results file must be an object (got: ${JSON.stringify(value)})`] };
  }
  const v = value as Record<string, unknown>;

  if (!Array.isArray(v.segmentEvaluations)) {
    errors.push(`segmentEvaluations is required and must be an array (got: ${JSON.stringify(v.segmentEvaluations)})`);
  }
  if (!Array.isArray(v.runEvaluations)) {
    errors.push(`runEvaluations is required and must be an array (got: ${JSON.stringify(v.runEvaluations)})`);
  }
  if (errors.length > 0) return { valid: false, errors };

  const segmentEvaluationsRaw = v.segmentEvaluations as unknown[];
  const runEvaluationsRaw = v.runEvaluations as unknown[];

  segmentEvaluationsRaw.forEach((entry, i) => errors.push(...validateSegmentEvaluation(entry, `segmentEvaluations[${i}]`)));
  runEvaluationsRaw.forEach((entry, i) => errors.push(...validateRunEvaluation(entry, `runEvaluations[${i}]`)));

  if (errors.length > 0) return { valid: false, errors };

  const segmentEvaluations = segmentEvaluationsRaw as SegmentEvaluation[];
  const runEvaluations = runEvaluationsRaw as RunEvaluation[];

  // --- duplicate run keys ---
  const runIndicesByKey = new Map<string, number[]>();
  runEvaluations.forEach((r, i) => {
    const key = runKeyOf(r);
    const list = runIndicesByKey.get(key) ?? [];
    list.push(i);
    runIndicesByKey.set(key, list);
  });
  const duplicateRunKeys = new Set<string>();
  for (const [key, indices] of runIndicesByKey) {
    if (indices.length > 1) {
      duplicateRunKeys.add(key);
      errors.push(
        `runEvaluations contains duplicate run key ${describeKey(key)} at indices [${indices.join(", ")}] — each (transcriptId, promptVariant, runNumber) must be unique, even if every other field is identical or usedFallback differs between them`,
      );
    }
  }

  // --- duplicate segmentIndex within a run (the same index is fine across different runs) ---
  const segmentIndicesByRunKey = new Map<string, Map<number, number[]>>();
  segmentEvaluations.forEach((s, i) => {
    const key = runKeyOf(s);
    if (!segmentIndicesByRunKey.has(key)) segmentIndicesByRunKey.set(key, new Map());
    const byIndex = segmentIndicesByRunKey.get(key)!;
    const list = byIndex.get(s.segmentIndex) ?? [];
    list.push(i);
    byIndex.set(s.segmentIndex, list);
  });
  for (const [key, byIndex] of segmentIndicesByRunKey) {
    for (const [segIndex, entryIndices] of byIndex) {
      if (entryIndices.length > 1) {
        errors.push(
          `segmentEvaluations contains duplicate segmentIndex=${segIndex} for run ${describeKey(key)} at indices [${entryIndices.join(", ")}] — segmentIndex must be unique within a run`,
        );
      }
    }
  }

  // --- orphan segments: every segment's run key must match some run ---
  segmentEvaluations.forEach((s, i) => {
    const key = runKeyOf(s);
    if (!runIndicesByKey.has(key)) {
      errors.push(`segmentEvaluations[${i}] ${describeKey(key)} has no matching entry in runEvaluations`);
    }
  });

  // --- segmentCount cross-check, skipped for duplicated (ambiguous) run keys ---
  const segmentCountByRunKey = new Map<string, number>();
  segmentEvaluations.forEach((s) => {
    const key = runKeyOf(s);
    segmentCountByRunKey.set(key, (segmentCountByRunKey.get(key) ?? 0) + 1);
  });
  runEvaluations.forEach((r, i) => {
    const key = runKeyOf(r);
    if (duplicateRunKeys.has(key)) return; // already reported above; counting against an ambiguous key is meaningless
    const actual = segmentCountByRunKey.get(key) ?? 0;
    if (r.segmentCount !== actual) {
      errors.push(
        `runEvaluations[${i}] ${describeKey(key)} declares segmentCount=${r.segmentCount} but ${actual} associated segmentEvaluation record(s) were found`,
      );
    }
  });

  return { valid: errors.length === 0, errors };
}

// --- Requirement 4: fallback runs AND unknown-provenance data must be excluded from prompt-quality comparisons ---

/**
 * True for a SINGLE run object, in isolation, whose own usedFallback field
 * says it wasn't a fallback. This cannot detect key ambiguity (duplicate
 * (transcriptId, promptVariant, runNumber) rows) by itself, since that's a
 * property of a whole list, not of one run — see filterComparableRuns()
 * for the list-level guarantee that actually matters for a comparison.
 */
export function isComparable(run: RunEvaluation): boolean {
  return !run.usedFallback;
}

/**
 * Runs that can safely be used in a prompt-quality comparison (including a
 * run-level aggregate like a mean variety score). A run is included ONLY
 * when its (transcriptId, promptVariant, runNumber) key matches EXACTLY
 * ONE entry in `runs` — i.e. itself and nothing else — AND usedFallback is
 * false. A duplicated key excludes EVERY row sharing it, regardless of
 * whether those rows agree or disagree on usedFallback: once a key is
 * ambiguous, no single row's own usedFallback value can be trusted, so
 * "unknown" never defaults to comparable here either. This mirrors
 * filterComparableSegments()'s own key-matching logic exactly, which is
 * what keeps filterComparable()'s run-level and segment-level results
 * consistent with each other (see that function).
 */
export function filterComparableRuns(runs: readonly RunEvaluation[]): RunEvaluation[] {
  const countByKey = new Map<string, number>();
  for (const run of runs) {
    const key = runKeyOf(run);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }
  return runs.filter((run) => countByKey.get(runKeyOf(run)) === 1 && isComparable(run));
}

/**
 * Segment evaluations that can safely be used in a prompt-quality
 * comparison. A segment is included ONLY when its (transcriptId,
 * promptVariant, runNumber) key matches EXACTLY ONE run, and that run's
 * usedFallback is false. Every other case is excluded, not just fallback
 * segments:
 *
 *   - a segment whose key matches NO run at all (an orphan — this would
 *     be rejected by validateResultsFile, but this function doesn't
 *     assume its input was validated) has unknown fallback status, so it
 *     is excluded, never included by default;
 *   - a segment whose key matches MORE THAN ONE run (an ambiguous/
 *     duplicated run key — also something validateResultsFile would
 *     reject) is excluded too, even if every one of those duplicate runs
 *     happens to agree on usedFallback — the data itself is invalid, and
 *     this function does not try to resolve that ambiguity on its own;
 *   - a segment whose single matching run has usedFallback=true is
 *     excluded, as before.
 *
 * This is the exact same "exactly one matching, non-fallback run" rule
 * filterComparableRuns() applies above, which is what guarantees
 * filterComparable()'s two output arrays stay consistent: a key is never
 * comparable for runs but not for segments, or vice versa.
 *
 * This function does not throw on malformed input — it silently narrows
 * to only what can be positively confirmed comparable, which is the
 * correct behavior for "never default to comparable". A caller who needs
 * to know WHY a segment was dropped (missing run vs. ambiguous run vs.
 * genuine fallback) should run validateResultsFile() first; this function
 * does not distinguish those cases in its return value.
 */
export function filterComparableSegments(
  segments: readonly SegmentEvaluation[],
  runs: readonly RunEvaluation[],
): SegmentEvaluation[] {
  const runsByKey = new Map<string, RunEvaluation[]>();
  for (const run of runs) {
    const key = runKeyOf(run);
    const list = runsByKey.get(key) ?? [];
    list.push(run);
    runsByKey.set(key, list);
  }
  return segments.filter((s) => {
    const matches = runsByKey.get(runKeyOf(s));
    if (!matches || matches.length !== 1) return false; // orphan or ambiguous — fallback status is unknown
    return !matches[0]!.usedFallback;
  });
}

/**
 * Convenience wrapper applying both filters to a whole results file.
 * Because filterComparableRuns() and filterComparableSegments() apply the
 * identical "exactly one matching, non-fallback run" rule, the two arrays
 * this returns are always consistent: a run appears in runEvaluations iff
 * its key is unambiguous and non-fallback, and a segment appears in
 * segmentEvaluations only when the run it points to meets that same bar —
 * there is no case where a run shows up here with zero possible
 * comparable segments behind it, or vice versa.
 */
export function filterComparable(file: EvaluationResultsFile): EvaluationResultsFile {
  return {
    runEvaluations: filterComparableRuns(file.runEvaluations),
    segmentEvaluations: filterComparableSegments(file.segmentEvaluations, file.runEvaluations),
  };
}
