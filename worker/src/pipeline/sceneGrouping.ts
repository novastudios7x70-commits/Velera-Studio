import type { Scene } from "../lib/database.types.js";

/**
 * One Higgsfield visual-generation unit: a contiguous run of scene_plan
 * scenes that share a single generated visual (see the Step 4G design
 * audit). scene_indices/scenes preserve original scene_plan order —
 * group_id is just the group's own position in the final, ceiling-enforced
 * grouping, not a re-derivation of scene order.
 */
export type SceneGenerationGroup = {
  group_id: number;
  scene_indices: number[];
  scenes: Scene[];
};

function normalizeSetting(setting: string): string {
  return setting.trim().toLowerCase();
}

// Order-independent, case/whitespace-insensitive character-set comparison —
// ["Leo", "Mara"] and ["mara", " leo "] must compare equal, since the LLM
// planner has no guarantee of consistent casing/whitespace/ordering across
// scenes that are otherwise clearly the same characters.
function normalizedCharacterSet(characters: string[]): string[] {
  return [...new Set(characters.map((c) => c.trim().toLowerCase()))].sort();
}

function sameCharacterSet(a: string[], b: string[]): boolean {
  const na = normalizedCharacterSet(a);
  const nb = normalizedCharacterSet(b);
  return na.length === nb.length && na.every((c, i) => c === nb[i]);
}

// The only two fields that determine whether two adjacent scenes can share
// one generated visual — setting and characters are what a still image (and
// its animation) actually depicts. shot_type/camera_motion/action legitimately
// vary within one continuous scene (an establishing shot then a close-up of
// the same setting/characters) and must never block a merge.
function sameVisualContext(a: Scene, b: Scene): boolean {
  return normalizeSetting(a.setting) === normalizeSetting(b.setting) && sameCharacterSet(a.characters, b.characters);
}

// Pass 1 (Step 4G): walk scenes in existing order, extending the current
// contiguous group whenever a scene matches the immediately preceding
// scene's visual context, starting a new group otherwise. Comparing each
// scene only to its immediate predecessor (rather than the group's first
// scene) is equivalent here since groups are always contiguous — the
// previous scene in the array is always the last scene in the current
// group.
function buildNaturalGroups(scenes: Scene[]): number[][] {
  const groups: number[][] = [[0]];
  for (let i = 1; i < scenes.length; i++) {
    if (sameVisualContext(scenes[i - 1], scenes[i])) {
      groups[groups.length - 1].push(i);
    } else {
      groups.push([i]);
    }
  }
  return groups;
}

// Pass 2 (Step 4G): force-merge adjacent groups until the count is within
// budget — a deterministic fallback, only ever exercised when similarity-
// based grouping alone didn't already fit under the cap. Repeatedly merges
// whichever adjacent pair has the smallest combined scene count (favoring
// merging already-small/simple groups over disrupting large ones); a
// strict `<` comparison (never `<=`) means the first pair found at the
// minimum count wins ties, i.e. the leftmost pair.
function mergeGroupsToLimit(naturalGroups: number[][], maxGenerations: number): number[][] {
  const groups = naturalGroups.map((g) => [...g]);
  while (groups.length > maxGenerations) {
    let bestPairIndex = 0;
    let bestCombinedCount = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const combinedCount = groups[i].length + groups[i + 1].length;
      if (combinedCount < bestCombinedCount) {
        bestCombinedCount = combinedCount;
        bestPairIndex = i;
      }
    }
    const merged = [...groups[bestPairIndex], ...groups[bestPairIndex + 1]];
    groups.splice(bestPairIndex, 2, merged);
  }
  return groups;
}

/**
 * Groups a scene plan's scenes into at most maxGenerations contiguous
 * Higgsfield visual-generation units (see the Step 4G design audit) —
 * scenes within one group share a single generated visual, assigned later
 * by whatever calls this. Pure and isolated: no Higgsfield/Supabase/FFmpeg
 * access, no database writes, no story invention — it only partitions the
 * Scene[] it's given. Not yet called from anywhere in the job pipeline.
 *
 * maxGenerations is a required argument, not a hardcoded constant, per the
 * Step 4G design's requirement that the generation ceiling live in exactly
 * one place (the future MAX_VISUAL_GENERATIONS_PER_JOB in
 * generateVisuals.ts) rather than being duplicated here.
 */
export function groupScenesForGeneration(scenes: Scene[], maxGenerations: number): SceneGenerationGroup[] {
  if (scenes.length === 0) {
    throw new Error("groupScenesForGeneration: scenes must not be empty");
  }
  if (!Number.isInteger(maxGenerations) || maxGenerations < 1) {
    throw new Error(`groupScenesForGeneration: maxGenerations must be a positive integer, got ${maxGenerations}`);
  }

  const naturalGroups = buildNaturalGroups(scenes);
  const finalGroups = mergeGroupsToLimit(naturalGroups, maxGenerations);

  return finalGroups.map((sceneIndices, group_id) => ({
    group_id,
    scene_indices: sceneIndices,
    scenes: sceneIndices.map((i) => scenes[i]),
  }));
}
