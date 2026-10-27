-- Supports the job-reliability/reconciliation work: (1) makes
-- refund_job_reservation() safe to call more than once for the same job,
-- closing the "enqueue looked like it failed but Redis actually got it"
-- and "worker process died before updating Supabase" gaps where a job can
-- be stuck non-terminal with its credit never refunded; (2) gives a
-- conservative, auditable stale-job reconciler (worker/src/reconcile.ts) a
-- durable marker distinguishing "this row has been reconciled" from
-- ordinary worker-driven failures, without ever letting that marker alone
-- stand in for proof of historical refund state (jobs created before this
-- migration existed can never have had this column set either way).

alter table public.jobs
  add column reservation_refunded_at timestamptz;

alter table public.jobs
  add column reconciled_at timestamptz;

-- Explicitly, unambiguously distinct from reconciled_at: reconciled_at
-- means "the reconciler claimed this row by flipping its status," which by
-- itself doesn't say whether the credit refund that claim promised ever
-- actually landed. This column means exactly "the reconciler is still
-- waiting on that specific refund to complete" — set the moment a claim
-- succeeds, cleared the moment the refund is confirmed (by this attempt or
-- by discovering it already happened). It is never set or read by
-- anything except worker/src/reconcile.ts, so a future unrelated use of
-- reconciled_at (or an organic worker-driven failure, which never touches
-- either of these two columns at all) can never be mistaken for a pending
-- reconciler refund.
alter table public.jobs
  add column reconciliation_refund_pending_at timestamptz;

-- Records the real wall-clock instant this migration actually executes —
-- not a date guessed in advance and hardcoded into application code. This
-- is the only trustworthy answer to "when did the audit mechanism above
-- (reservation_refunded_at's idempotency claim) actually start existing,"
-- which is exactly what worker/src/reconcile.ts's historical cutoff needs:
-- a job created before this row's activated_at could have had its
-- reservation refunded at any earlier point via the old, non-idempotent
-- refund_job_reservation(), and reservation_refunded_at being null on such
-- a job proves nothing — the column didn't exist yet to record it. A job
-- created at or after activated_at, by contrast, could only ever have been
-- refunded via the function defined below, so its audit columns are fully
-- trustworthy. RLS is enabled with no policies: this table is internal
-- migration metadata, read only by the worker's service-role client
-- (which bypasses RLS), never exposed via PostgREST to any other role.
create table public.migration_activations (
  migration text primary key,
  activated_at timestamptz not null default now()
);

alter table public.migration_activations enable row level security;

insert into public.migration_activations (migration, activated_at)
values ('0022_job_reconciliation', now())
on conflict (migration) do nothing;

-- Whole-function replace of the live 0003_functions.sql definition.
-- Behavior preserved exactly (plan-specific credit adjustments, signature,
-- SECURITY DEFINER, search_path) — the only change is making it
-- idempotent and making every failure mode either visibly succeed with
-- both halves committed, or raise and roll back everything, never a
-- silent partial effect.
--
-- The signature, SECURITY DEFINER, and service_role-only grant are
-- unchanged from 0003_functions.sql (confirmed by inspection — CREATE OR
-- REPLACE preserves existing grants for an unchanged signature, so no
-- grant/revoke statements are needed here).
create or replace function public.refund_job_reservation(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
  v_upload uploads%rowtype;
  v_is_generate boolean;
begin
  -- The claim: only the first caller to see reservation_refunded_at IS NULL
  -- can ever update it. A second call (whether a genuine retry, a race, or
  -- months later) matches zero rows here and returns false without ever
  -- reaching the profiles update below — this is what makes the function
  -- idempotent rather than relying on the caller to remember whether it
  -- already refunded this job.
  update jobs
    set reservation_refunded_at = now()
    where id = p_job_id
      and reservation_refunded_at is null
    returning * into v_job;

  if not found then
    return false;
  end if;

  select * into v_upload
  from uploads
  where id = v_job.upload_id;

  -- Raising here (rather than silently proceeding with a null v_upload, as
  -- the pre-0022 version's plain SELECT INTO allowed) is what guarantees
  -- the invariant: Postgres rolls back everything this function did in
  -- this invocation, including the UPDATE above, so an unresolvable upload
  -- can never leave the job's reservation claimed without a matching
  -- credit adjustment.
  if not found then
    raise exception
      'refund_job_reservation: upload % not found for job %',
      v_job.upload_id,
      p_job_id;
  end if;

  v_is_generate := v_upload.visual_source = 'generate';

  update profiles
  set
    clips_remaining = case
      when plan = 'trial' then clips_remaining + 1
      else clips_remaining
    end,
    generated_clips_remaining = case
      when plan = 'trial' and v_is_generate
        then generated_clips_remaining + 1
      else generated_clips_remaining
    end,
    clips_used_this_cycle = case
      when plan not in ('trial', 'agency')
        then greatest(clips_used_this_cycle - 1, 0)
      else clips_used_this_cycle
    end,
    generated_clips_used_this_cycle = case
      when plan not in ('trial', 'agency') and v_is_generate
        then greatest(generated_clips_used_this_cycle - 1, 0)
      else generated_clips_used_this_cycle
    end
  where id = v_job.user_id;

  -- Same reasoning as the upload check above: a profiles row that doesn't
  -- exist (or, under RLS/FK drift, no longer matches) must roll back the
  -- claim too, not silently leave the job marked refunded with no credit
  -- ever actually restored. This is the exact gap the pre-0022 version had
  -- — this UPDATE could silently affect zero rows and the function would
  -- still return having done nothing for the customer.
  if not found then
    raise exception
      'refund_job_reservation: profile % not found for job %',
      v_job.user_id,
      p_job_id;
  end if;

  -- Reaching here means both halves of the invariant — the claim and the
  -- credit adjustment — are part of the same not-yet-committed transaction
  -- and will commit together. A `true` return is never reachable any other
  -- way.
  return true;
end;
$$;
