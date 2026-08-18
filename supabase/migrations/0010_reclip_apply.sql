-- Atomically applies a completed reclip render across all of a moment's clip
-- rows in a single transaction. runReclipPhase renders once per moment (one
-- vertical file shared by tiktok/shorts/reels/facebook, one pinterest file)
-- but the moment can span up to 5 clip rows with two different file_url
-- values — two separate UPDATE calls from the worker could leave the moment
-- split (some rows on the new render, some still on the old one) if the
-- second call failed after the first succeeded. A single function call runs
-- as one implicit transaction, so both groups commit together or neither
-- does. Either array may be empty/null — `id = any(...)` on an empty or
-- null array simply matches zero rows, so no separate guard is needed.
create function public.apply_reclip(
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
    render_started_at = null
  where id = any(p_vertical_clip_ids);

  update clips set
    file_url = p_pinterest_file_url,
    thumbnail_url = p_thumbnail_url,
    start_time = p_start_time,
    end_time = p_end_time,
    duration_seconds = p_duration_seconds,
    render_started_at = null
  where id = any(p_pinterest_clip_ids);
end;
$$;

-- Service-role only, same reasoning as claim_clip_credit/refund_job_reservation
-- — the worker's admin client is the only caller, never a Next.js route.
revoke all on function public.apply_reclip(uuid[], uuid[], text, text, text, text, text, int) from public, authenticated, anon;
grant execute on function public.apply_reclip(uuid[], uuid[], text, text, text, text, text, int) to service_role;
