import { z } from "zod";

// Step 1 of the script → scene-planning architecture (see the architecture
// audit this session): the structured representation of one visual beat
// derived from a user's script, and the Zod schema used to validate an
// LLM's scene-planning output against that shape — mirroring how
// selectSegments.ts separates SelectedSegment (the hand-written stored
// type, in database.types.ts) from segmentSchema (the private Zod schema
// that validates the LLM's raw response before it's mapped into that type).
//
// Deliberately excluded from this MVP shape, per the architecture audit:
// - start_time/end_time — timing is assigned afterward by matching each
//   scene's dialogue to the voiceover's real transcript timestamps, not
//   produced by the planner itself (the voiceover doesn't exist yet at
//   planning time).
// - visual_prompt — synthesized later from these structured fields (the
//   same relationship buildScenePrompt/buildMotionPrompt already have to
//   contentType/moodDescription/style in generateVisuals.ts), not asked of
//   the LLM directly, to avoid the LLM prescribing final prompt text that's
//   redundant with (and could drift from) the structured fields below.
// - any character-reference/consistency fields — explicitly out of scope
//   for the MVP; see the architecture audit's Future section.
//
// This type is not yet part of database.types.ts because there is no
// database column for it yet (no migration has been added — see the
// architecture audit's implementation plan, step 4) — it belongs there
// once a `jobs.scene_plan` column exists to mirror.
export type Scene = {
  description: string;
  characters: string[];
  setting: string;
  action: string;
  shot_type: "establishing" | "wide" | "medium" | "two_shot" | "close_up" | "tracking";
  camera_motion: string;
};

const sceneSchema = z.object({
  description: z.string().min(1).max(300),
  characters: z.array(z.string().min(1).max(60)).max(6),
  setting: z.string().min(1).max(160),
  action: z.string().min(1).max(300),
  shot_type: z.enum(["establishing", "wide", "medium", "two_shot", "close_up", "tracking"]),
  camera_motion: z.string().min(1).max(120),
});

// Bounded at 8 scenes — the architecture audit's Option C ("a small,
// bounded number of visual beats") rather than one generation per line of
// dialogue, to keep Higgsfield API usage and job latency predictable
// regardless of script length.
export const scenePlanResponseSchema = z.object({ scenes: z.array(sceneSchema).min(1).max(8) });
