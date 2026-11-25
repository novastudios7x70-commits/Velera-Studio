import { interviewClean } from "./interview.clean.mjs";
import { interviewNoisy } from "./interview.noisy.mjs";
import { tutorialClean } from "./tutorial.clean.mjs";
import { tutorialNoisy } from "./tutorial.noisy.mjs";
import { comedyClean } from "./comedy.clean.mjs";
import { comedyNoisy } from "./comedy.noisy.mjs";
import { emotionalClean } from "./emotional.clean.mjs";
import { emotionalNoisy } from "./emotional.noisy.mjs";
import { vlogClean } from "./vlog.clean.mjs";
import { vlogNoisy } from "./vlog.noisy.mjs";
import type { Fixture } from "./types.mjs";

export const FIXTURES: readonly Fixture[] = [
  interviewClean,
  interviewNoisy,
  tutorialClean,
  tutorialNoisy,
  comedyClean,
  comedyNoisy,
  emotionalClean,
  emotionalNoisy,
  vlogClean,
  vlogNoisy,
];

export const FIXTURES_BY_ID: ReadonlyMap<string, Fixture> = new Map(FIXTURES.map((f) => [f.id, f]));

export type { Fixture, FixtureSentence, FixtureCategory, FixtureVariant } from "./types.mjs";
