-- Stores the script -> visual-scene-plan output (see scenePlanner.ts and
-- the architecture audit for the script-driven generate-video path) so it
-- survives across the discover/transform phase boundary. Nullable: no
-- existing row has ever had a scene plan, and a failed/not-yet-run planning
-- attempt is expected to leave this null rather than fail the job (see the
-- architecture audit's failure-handling recommendation). Not yet written or
-- read by any code — this migration only adds the column.
alter table jobs add column scene_plan jsonb;
