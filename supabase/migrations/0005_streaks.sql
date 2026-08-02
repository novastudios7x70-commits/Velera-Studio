-- Daily upload streak — tracked server-side inside create_job() (the same
-- row-locked function that already gates credits) rather than as a
-- client-computed value, so it can't be spoofed and stays consistent with
-- the existing credit-reservation pattern.
alter table profiles add column streak_count int not null default 0;
alter table profiles add column streak_last_active_date date;

create or replace function public.create_job(p_upload_id uuid)
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
  v_today date := current_date;
  v_new_streak int;
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

  -- A day with at least one upload extends the streak by one; a gap of more
  -- than a day resets it to 1; a second upload on the same day is a no-op.
  -- Counts on attempt, not success — a job that later fails still means the
  -- user showed up today, and refund_job_reservation() intentionally leaves
  -- the streak alone.
  if v_profile.streak_last_active_date = v_today then
    v_new_streak := v_profile.streak_count;
  elsif v_profile.streak_last_active_date = v_today - 1 then
    v_new_streak := v_profile.streak_count + 1;
  else
    v_new_streak := 1;
  end if;

  if v_profile.plan = 'trial' then
    if v_profile.clips_remaining < 1 then
      raise exception 'no clips remaining on trial plan' using errcode = 'P0001';
    end if;
    if v_is_generate and v_profile.generated_clips_remaining < 1 then
      raise exception 'no generated-visual clips remaining on trial plan' using errcode = 'P0001';
    end if;
    update profiles set
      clips_remaining = clips_remaining - 1,
      generated_clips_remaining = case when v_is_generate then generated_clips_remaining - 1 else generated_clips_remaining end,
      streak_count = v_new_streak,
      streak_last_active_date = v_today
    where id = v_user_id;
  elsif v_profile.plan = 'agency' then
    update profiles set
      streak_count = v_new_streak,
      streak_last_active_date = v_today
    where id = v_user_id;
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
      generated_clips_used_this_cycle = case when v_is_generate then generated_clips_used_this_cycle + 1 else generated_clips_used_this_cycle end,
      streak_count = v_new_streak,
      streak_last_active_date = v_today
    where id = v_user_id;
  end if;

  insert into jobs (upload_id, user_id, status)
  values (p_upload_id, v_user_id, 'queued')
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function public.create_job(uuid) to authenticated;
