-- Credit-gating functions.
--
-- Credit model: one "clip" credit is reserved atomically the moment a job is
-- created (create_job) — this is what stops a burst of requests from queuing
-- more jobs than a plan allows, per the build spec's scalability requirement.
-- A job can ultimately produce up to 5 segments (the LLM/segment-selection
-- step decides how many), so the worker tops up the reservation one credit
-- at a time as it finalizes each additional segment, via claim_clip_credit,
-- and simply stops adding clips once credits run out. Generated-visual jobs
-- reserve/claim from the generated-clip sub-cap in lockstep with the general
-- cap, since that path is the expensive one the sub-cap exists to bound.

create function public.create_job(p_upload_id uuid)
returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_upload uploads%rowtype;
  v_profile profiles%rowtype;
  v_job jobs%rowtype;
  v_is_generate boolean;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_upload from uploads where id = p_upload_id and user_id = v_user_id;
  if not found then
    raise exception 'upload not found' using errcode = 'P0002';
  end if;

  -- Row lock serializes concurrent job-creation requests from the same user,
  -- which is what makes the credit check below race-safe.
  select * into v_profile from profiles where id = v_user_id for update;

  v_is_generate := v_upload.visual_source = 'generate';

  if v_profile.plan = 'trial' then
    if v_profile.clips_remaining < 1 then
      raise exception 'no clips remaining on trial plan' using errcode = 'P0001';
    end if;
    if v_is_generate and v_profile.generated_clips_remaining < 1 then
      raise exception 'no generated-visual clips remaining on trial plan' using errcode = 'P0001';
    end if;
    update profiles set
      clips_remaining = clips_remaining - 1,
      generated_clips_remaining = case when v_is_generate then generated_clips_remaining - 1 else generated_clips_remaining end
    where id = v_user_id;
  elsif v_profile.plan = 'agency' then
    null; -- unlimited, custom-negotiated — no counters to enforce
  else
    if v_profile.clips_monthly_allowance is null
       or v_profile.clips_used_this_cycle >= v_profile.clips_monthly_allowance then
      raise exception 'monthly clip allowance reached' using errcode = 'P0001';
    end if;
    if v_is_generate and (
      v_profile.generated_clips_allowance is null
      or v_profile.generated_clips_used_this_cycle >= v_profile.generated_clips_allowance
    ) then
      raise exception 'monthly generated-clip allowance reached' using errcode = 'P0001';
    end if;
    update profiles set
      clips_used_this_cycle = clips_used_this_cycle + 1,
      generated_clips_used_this_cycle = case when v_is_generate then generated_clips_used_this_cycle + 1 else generated_clips_used_this_cycle end
    where id = v_user_id;
  end if;

  insert into jobs (upload_id, user_id, status)
  values (p_upload_id, v_user_id, 'queued')
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function public.create_job(uuid) to authenticated;

-- Worker-only: claim one additional clip credit beyond the initial
-- reservation, as the segment-selection step finds more than one
-- hook-worthy moment. Returns false (no exception) when the user is out of
-- credit so the worker can simply stop adding clips instead of failing the job.
create function public.claim_clip_credit(p_user_id uuid, p_generated boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where id = p_user_id for update;
  if not found then
    return false;
  end if;

  if v_profile.plan = 'trial' then
    if v_profile.clips_remaining < 1 then
      return false;
    end if;
    if p_generated and v_profile.generated_clips_remaining < 1 then
      return false;
    end if;
    update profiles set
      clips_remaining = clips_remaining - 1,
      generated_clips_remaining = case when p_generated then generated_clips_remaining - 1 else generated_clips_remaining end
    where id = p_user_id;
    return true;
  elsif v_profile.plan = 'agency' then
    return true;
  else
    if v_profile.clips_monthly_allowance is null
       or v_profile.clips_used_this_cycle >= v_profile.clips_monthly_allowance then
      return false;
    end if;
    if p_generated and (
      v_profile.generated_clips_allowance is null
      or v_profile.generated_clips_used_this_cycle >= v_profile.generated_clips_allowance
    ) then
      return false;
    end if;
    update profiles set
      clips_used_this_cycle = clips_used_this_cycle + 1,
      generated_clips_used_this_cycle = case when p_generated then generated_clips_used_this_cycle + 1 else generated_clips_used_this_cycle end
    where id = p_user_id;
    return true;
  end if;
end;
$$;

-- Service-role only — the worker authenticates with the service key, which
-- already bypasses RLS, but we still scope execute grants tightly since this
-- function spends real money-equivalent credit on the caller's behalf.
revoke all on function public.claim_clip_credit(uuid, boolean) from public, authenticated, anon;
grant execute on function public.claim_clip_credit(uuid, boolean) to service_role;

-- Refund the initial reservation if a job fails before producing any clips
-- (e.g. transcription/API failure) — otherwise a failed job would silently
-- burn a credit with nothing to show for it.
create function public.refund_job_reservation(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
  v_upload uploads%rowtype;
  v_is_generate boolean;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    return;
  end if;

  select * into v_upload from uploads where id = v_job.upload_id;
  v_is_generate := v_upload.visual_source = 'generate';

  update profiles set
    clips_remaining = case when plan = 'trial' then clips_remaining + 1 else clips_remaining end,
    generated_clips_remaining = case when plan = 'trial' and v_is_generate then generated_clips_remaining + 1 else generated_clips_remaining end,
    clips_used_this_cycle = case when plan not in ('trial', 'agency') then greatest(clips_used_this_cycle - 1, 0) else clips_used_this_cycle end,
    generated_clips_used_this_cycle = case when plan not in ('trial', 'agency') and v_is_generate then greatest(generated_clips_used_this_cycle - 1, 0) else generated_clips_used_this_cycle end
  where id = v_job.user_id;
end;
$$;

revoke all on function public.refund_job_reservation(uuid) from public, authenticated, anon;
grant execute on function public.refund_job_reservation(uuid) to service_role;
