-- Close a billing-integrity gap: stripe_subscription_status has been
-- recorded on every relevant webhook since 0001, but nothing ever read it —
-- create_job()/claim_clip_credit() gate solely on plan + allowance/usage
-- counters. When a paid subscriber's card is declined, Stripe moves the
-- subscription to 'past_due' (then 'unpaid') and runs its own dunning retry
-- schedule — which can run for weeks — before finally firing
-- customer.subscription.deleted. For that entire window the user kept full
-- paid-plan access with no gate ever checking the status column.
--
-- Fix: block new job creation and additional per-segment credit claims for
-- paid plans (creator/studio) while stripe_subscription_status is 'past_due'
-- or 'unpaid'. Deliberately scoped to the paid branch only:
--   - 'trial' never has a Stripe subscription at all until checkout, and
--     this app doesn't configure Stripe trial periods (no
--     subscription_data.trial_period_days in checkout/route.ts), so
--     'trialing' should not occur in practice — but if it ever did, it's
--     left untouched here since the gate only looks at the paid branch.
--   - 'active' is untouched — this is the only status the paid branch
--     already runs under in the common case.
--   - 'agency' is unlimited/custom-negotiated and was never gated by
--     anything in this branch to begin with — left alone.
--   - 'canceled' already can't reach the paid branch in the normal flow:
--     customer.subscription.deleted resets plan to 'trial' in the same
--     write that sets status to 'canceled', so a canceled account is
--     already routed through the trial branch, gated by clips_remaining
--     (which that same webhook zeroes out).
-- This is a whole-function replace (function bodies are otherwise
-- byte-for-byte the same as their prior definitions in 0005_streaks.sql and
-- 0003_functions.sql) rather than a smaller ALTER, since Postgres has no
-- partial-body function edit — CREATE OR REPLACE FUNCTION preserves the
-- existing grants as long as the signature is unchanged, so no re-grant is
-- needed here.

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

create or replace function public.claim_clip_credit(p_user_id uuid, p_generated boolean)
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
    if v_profile.stripe_subscription_status in ('past_due', 'unpaid') then
      return false;
    end if;
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

revoke all on function public.claim_clip_credit(uuid, boolean) from public, authenticated, anon;
grant execute on function public.claim_clip_credit(uuid, boolean) to service_role;
