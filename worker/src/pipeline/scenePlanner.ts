import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../lib/env.js";
import type { Scene } from "../lib/database.types.js";

// The structured representation of one visual beat derived from a user's
// script (Scene, imported from database.types.ts — see jobs.scene_plan in
// 0019_jobs_scene_plan.sql) and the Zod schema used to validate an LLM's
// scene-planning output against that shape — mirroring how
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

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

// Only the one method planScenes actually calls — lets tests inject a fake
// client (see scenePlanner.test.mts) instead of mocking the whole SDK
// module, without introducing any new abstraction beyond this one seam.
type AnthropicMessagesClient = Pick<Anthropic, "messages">;

function buildPrompt(scriptText: string): string {
  const instructions = `You are a visual-storyboard planner for a short-form video tool. You will be given a USER SCRIPT (may include a title, character list, scene headings, dialogue, and action/stage directions).

Your job is to convert the script into a bounded sequence of VISUAL SCENES/BEATS that a video-generation model will use to create footage — you are not transcribing dialogue, and you are not writing a screenplay. Think like a director breaking a script into shots, not like a stenographer.

Rules:
- Return visual scenes/beats, not a line-by-line dialogue transcription. Do not create one scene per line of dialogue.
- Preserve the script's important characters, setting, key actions, and overall story progression — the scenes should visually tell the same story as the script.
- Break multi-character dialogue into visually meaningful shots (e.g. an establishing shot, a two-shot of both characters, a close-up/reaction shot, a detail shot of an important object) rather than one shot per spoken line.
- Include an establishing shot near the start when it would help set the scene.
- Include close-up or reaction shots where they would clarify an important story beat, object, or emotional turn.
- Do NOT invent major story events, characters, or outcomes that are not supported by the script. Only depict what the script actually describes or clearly implies.
- Do NOT generate final image/video-generation prompt text — describe the scene's content (description, characters, setting, action, shot type, camera motion) and nothing more; a separate step turns this into generation prompts.
- Do NOT assign timestamps or durations to any scene — timing is determined later from the actual generated voiceover, which does not exist yet.
- Use at most 8 scenes total, regardless of script length.
- Return ONLY valid JSON matching this shape, nothing else:
{"scenes":[{"description":string,"characters":string[],"setting":string,"action":string,"shot_type":"establishing"|"wide"|"medium"|"two_shot"|"close_up"|"tracking","camera_motion":string}]}`;

  return `${instructions}\n\nUSER SCRIPT:\n${scriptText}`;
}

/**
 * Converts a user-written script into a bounded, structured sequence of
 * visual scenes/beats (see Scene above) via a single Anthropic call,
 * validated against scenePlanResponseSchema.
 *
 * Deliberately isolated per the architecture audit's Step 2 scope: no
 * database/Supabase access, no filesystem or media processing, and no
 * calls to Higgsfield/ElevenLabs/FFmpeg — it only turns text into a
 * validated Scene[]. It is not yet called from anywhere in the job
 * pipeline (see jobRunner.ts), so it has no effect on current behavior.
 *
 * Unlike selectSegments.ts's heuristicFallback, this throws on failure
 * (empty script, an Anthropic error on both attempts, or output that
 * doesn't validate against the schema) rather than fabricating a
 * deterministic scene split — the architecture audit's design intent is
 * script-derived scenes, and a fake generic split would silently produce
 * content the script never described, which is exactly what schema
 * validation and the "do not invent" prompt rule above are trying to
 * prevent. Callers (once this is wired in) decide their own fallback
 * behavior, the same way selectSegments.ts's caller in jobRunner.ts checks
 * for a zero-segment result rather than selectSegments.ts silently
 * deciding what "no segments" should mean.
 */
export async function planScenes(scriptText: string, client: AnthropicMessagesClient = anthropic): Promise<Scene[]> {
  if (!scriptText || !scriptText.trim()) {
    throw new Error("Cannot plan scenes for an empty script");
  }

  const prompt = buildPrompt(scriptText);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: env.anthropicModel,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) continue;

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = scenePlanResponseSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) continue;

      return parsed.data.scenes;
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
      console.error(`[scenePlanner] Anthropic call failed (attempt ${attempt + 1}, status ${status ?? "n/a"}):`, err instanceof Error ? err.message : err);
      // fall through to retry, then throw below
    }
  }

  throw new Error("Scene planning failed: Anthropic did not return a valid scene plan after 2 attempts");
}
