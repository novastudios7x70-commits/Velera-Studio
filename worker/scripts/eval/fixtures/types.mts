// Shared types for the Step 3A evaluation fixtures. See ../README.md and
// ../rubric.md for how these are used.

export interface FixtureSentence {
  text: string;
  // Extra silence before this sentence starts, in seconds (e.g. a comedic
  // beat, a breath before an emotional line). Mirrors the same field in
  // worker/scripts/selectSegments.eval.mts's fixture format.
  pauseBeforeSeconds?: number;
}

export type FixtureCategory = "interview" | "tutorial" | "comedy" | "emotional" | "vlog";
export type FixtureVariant = "clean" | "noisy";

export interface Fixture {
  id: string;
  category: FixtureCategory;
  variant: FixtureVariant;
  // Bumped by hand whenever this fixture's content changes, so a
  // RunEvaluation's fixtureVersion can point at exactly what was used even
  // after this file is later edited.
  version: string;
  // Orientation for whoever scores this fixture's output — what it's
  // meant to stress-test, and roughly where a plausible good clip might
  // live. Deliberately NOT a ground-truth answer key: an evaluator should
  // still have to judge quality, not check a box against this text.
  designNotes: string;
  sentences: FixtureSentence[];
}
