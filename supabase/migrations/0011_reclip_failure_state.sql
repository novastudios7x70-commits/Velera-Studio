-- Explicit reclip failure signal. Without this, Review had no reliable way
-- to tell a failed re-render apart from a successful one — the worker's
-- failure path only ever cleared render_started_at, leaving file_url/
-- start_time/end_time exactly as they were, which is indistinguishable from
-- "hasn't updated yet" without inferring from whether those fields changed.
-- render_failed_at makes that an explicit column instead of a heuristic:
-- cleared when a new attempt starts (POST /api/clips/[id]/re-render's claim
-- update) or succeeds (apply_reclip below), set by the worker's reclip
-- failure path (runReclipPhase's catch block) — never left stuck true past
-- the next attempt.
alter table clips add column render_failed_at timestamptz;

-- Re-create apply_reclip (same signature — no caller needs to change) so a
-- successful reclip also explicitly clears render_failed_at. This should
-- already be null by the time a reclip succeeds (the re-render route clears
-- it when the attempt starts), but doing it here too means this function's
-- own success path is fully self-consistent on its own, not dependent on
-- another caller having cleared it first.
create or replace function public.apply_reclip(
  p_vertical_clip_ids uuid[],
  p_pinterest_clip_ids uuid[],
  p_vertical_file_url text,
  p_pinterest_file_url text,
  p_thumbnail_url text,
  p_start_time text,
  p_end_time text,
  p_duration_seconds int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update clips set
    file_url = p_vertical_file_url,
    thumbnail_url = p_thumbnail_url,
    start_time = p_start_time,
    end_time = p_end_time,
    duration_seconds = p_duration_seconds,
    render_started_at = null,
    render_failed_at = null
  where id = any(p_vertical_clip_ids);

  update clips set
    file_url = p_pinterest_file_url,
    thumbnail_url = p_thumbnail_url,
    start_time = p_start_time,
    end_time = p_end_time,
    duration_seconds = p_duration_seconds,
    render_started_at = null,
    render_failed_at = null
  where id = any(p_pinterest_clip_ids);
end;
$$;

-- create or replace preserves existing grants, but repeating them keeps
-- this migration self-contained and correct to read in isolation.
revoke all on function public.apply_reclip(uuid[], uuid[], text, text, text, text, text, int) from public, authenticated, anon;
grant execute on function public.apply_reclip(uuid[], uuid[], text, text, text, text, text, int) to service_role;
