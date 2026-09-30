-- Stores per-visual-generation-group results for the script-driven
-- generate-video path (see sceneGrouping.ts and the Step 4G/4H design
-- audit) — kept separate from scene_plan by design: scene_plan is what the
-- planner says should happen, scene_visuals is what was actually generated.
-- Nullable: no existing row has ever had this, and a failed/not-yet-run
-- generation attempt is expected to leave this null. Not yet written or
-- read by any code — this migration only adds the column.
alter table public.jobs
  add column if not exists scene_visuals jsonb;
