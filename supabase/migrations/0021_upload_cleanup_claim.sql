-- Closes the cross-system TOCTOU race in the Storage lifecycle cleanup path
-- (POST /api/jobs): a Postgres "no job references this upload" check and the
-- Supabase Storage DELETE it gates can never be made atomic with each other
-- (they're two different systems with no shared transaction), so the check
-- alone isn't enough — a job can be created for the same upload in the gap
-- between the check and the delete. The fix is to make the *decision*
-- atomic on the Postgres side instead: claim_upload_for_storage_cleanup()
-- locks the upload row, verifies no job depends on it, and durably marks it
-- claimed in the same transaction; create_job() takes the same row lock and
-- refuses to proceed once a claim exists. Whichever of the two gets there
-- first wins, and the other observes the committed outcome — so once a
-- claim commits, no job can ever come to depend on that upload again, which
-- is what makes it safe to delete the Storage object afterward even though
-- that call happens outside this transaction.

alter table public.uploads
  add column cleanup_claimed_at timestamptz;

-- uploads.file_url previously had no uniqueness constraint, so two different
-- upload rows could in principle reference the same Storage object — which
-- would let a claim against one row miss a job that depends on the other.
-- A fresh client upload always mints a new random path
-- (`${user.id}/${crypto.randomUUID()}.${ext}`), so this should hold trivially
-- for existing data; confirmed against production before this migration was
-- written (0 duplicate non-null file_url values across all uploads rows).
create unique index uploads_file_url_unique
  on public.uploads (file_url)
  where file_url is not null;

-- Called from the request-scoped (authenticated) client in
-- src/app/api/jobs/route.ts's compensating-cleanup paths, never from the
-- worker's service-role client — hence SECURITY DEFINER (uploads has no
-- authenticated UPDATE grant at all, see 0015_jobs_uploads_column_protection.sql)
-- plus the auth.uid() ownership check, mirroring create_job()'s own
-- convention rather than claim_clip_credit()'s service-role-only one.
create function public.claim_upload_for_storage_cleanup(p_upload_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_upload uploads%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Row lock is what makes "no job references this upload" and "mark it
  -- claimed" one atomic decision — any concurrent create_job() call on the
  -- same upload blocks here until this transaction commits or rolls back.
  select * into v_upload from uploads
    where id = p_upload_id and user_id = v_user_id
    for update;

  if not found then
    return false;
  end if;

  if v_upload.cleanup_claimed_at is not null then
    return false;
  end if;

  if exists (select 1 from jobs where upload_id = p_upload_id) then
    return false;
  end if;

  update uploads set cleanup_claimed_at = now() where id = p_upload_id;
  return true;
end;
$$;

revoke all on function public.claim_upload_for_storage_cleanup(uuid) from public, anon;
grant execute on function public.claim_upload_for_storage_cleanup(uuid) to authenticated;

-- Whole-function replace of the live 0016_subscription_status_gating.sql
-- definition — byte-for-byte identical except for the two lines marked below.
-- Everything else (auth check, streak logic, plan/credit/subscription-status
-- gating, job insert, return value) is untouched.
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

  -- Changed: added `for update` so this lock is held for the rest of the
  -- transaction, serializing against a concurrent claim_upload_for_storage_cleanup() call.
  select * into v_upload from uploads where id = p_upload_id and user_id = v_user_id for update;
  if not found then
    raise exception 'upload not found' using errcode = 'P0002';
  end if;

  -- New: refuse to create a job for an upload whose Storage cleanup has
  -- already been claimed — see claim_upload_for_storage_cleanup() above.
  if v_upload.cleanup_claimed_at is not null then
    raise exception 'upload no longer available' using errcode = 'P0002';
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
    if v_profile.stripe_subscription_status in ('past_due', 'unpaid') then
      raise exception 'subscription payment is past due' using errcode = 'P0001';
    end if;
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
