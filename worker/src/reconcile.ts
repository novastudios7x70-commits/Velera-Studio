import { Queue } from "bullmq";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PIPELINE_QUEUE_NAME, createRedisConnection, type PipelineJobPayload } from "./queue.js";
import { isOwnGeneratedVisualPath } from "./jobRunner.js";
import type { Database, Job, Upload } from "./lib/database.types.js";

// Conservative, read-mostly stale-job reconciliation for jobs stuck
// non-terminal for an unreasonable length of time — the mechanism that
// closes the gap documented across this codebase's cleanup-on-failure work:
// a worker process (or Redis itself) can lose a job silently, leaving its
// Supabase row stuck forever with no automatic path back to a terminal
// state. This module is deliberately narrow:
//
// - It handles exactly three statuses — "queued", "cutting",
//   "generating_visuals" — not a general garbage collector for any
//   non-terminal status.
// - It never treats "the expected Redis job is absent" as proof of why —
//   only as one of several independently-required conditions that make it
//   SAFE to act, regardless of the underlying cause.
// - It never acts on a job that predates migration 0022's real activation
//   (see getMigrationCutoff below) — reservation_refunded_at/reconciled_at
//   being null on such a job proves nothing about its real refund
//   history, since those columns didn't exist when it was created.
// - Reconciling a job's status and refunding its credit are two separate
//   steps that cannot share one database transaction (one is a
//   conditional UPDATE from this process, the other is a separate RPC
//   call) — see reconcileJob's own comment for how the sequence is
//   ordered so a refund failure never leaves a job either stuck or
//   falsely marked complete.
// - No scheduler, cron, or invocation loop is included here — this module
//   exposes functions to be called with an already-fetched job, not a
//   driver that finds and sweeps stale jobs on its own.

// The historical cutoff is deliberately NOT a date hardcoded into this
// file — a guessed-in-advance constant can never actually equal the real
// moment migration 0022 ran, and migrations don't necessarily run the day
// they're written. Instead, 0022_job_reconciliation.sql itself records the
// real wall-clock instant it executed, in a one-row-per-migration table
// (migration_activations) created for exactly this purpose. Fetch it once
// per reconciliation pass via getMigrationCutoff() and pass the same Date
// into every per-job call below — it's a fixed historical fact (when the
// migration actually ran, once, forever), not something that moves
// forward over time or drifts between calls.
//
// Any job whose created_at predates this cutoff is "historical" — for
// such a job, reservation_refunded_at being null proves nothing about
// whether it was already refunded under the old, non-auditable
// refund_job_reservation() that existed before this migration replaced
// it. The reconciler must never act on such a job, no matter what its
// audit columns say; recovering those jobs is an explicitly separate,
// manual, human-reviewed process.
export async function getMigrationCutoff(supabase: SupabaseClient<Database>): Promise<Date | null> {
  const { data, error } = await supabase
    .from("migration_activations")
    .select("activated_at")
    .eq("migration", "0022_job_reconciliation")
    .maybeSingle();

  if (error || !data) {
    // Unknown cutoff must never be treated as "no cutoff" (which would let
    // every job through) — every caller below treats null as "cannot
    // prove this job is post-cutoff," which is the same fail-safe
    // direction as treating everything as historical.
    console.error(
      "[reconcile] could not resolve migration 0022 activation timestamp — treating every job as historical until this resolves:",
      error?.message ?? "no row found",
    );
    return null;
  }
  return new Date(data.activated_at);
}

// How long a job may sit non-terminal before it's even considered for
// reconciliation — comfortably longer than any legitimate processing
// phase, including the 20-minute Higgsfield poll timeout in
// generateVisuals.ts.
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Abstraction over "does the expected BullMQ job still exist" so the
// per-state functions below can be tested without a real Redis connection.
// hasJob must never mutate queue state — it exists purely to answer
// existence, not to inspect, remove, retry, or promote anything.
export interface QueueJobChecker {
  hasJob(jobId: string): Promise<boolean>;
}

// Real implementation, backed by BullMQ's own read-only getJob() lookup —
// not wired into any scheduler here; callers construct this themselves
// when/if they actually run reconciliation.
export function createBullMqJobChecker(): QueueJobChecker {
  const queue = new Queue<PipelineJobPayload>(PIPELINE_QUEUE_NAME, { connection: createRedisConnection() });
  return {
    async hasJob(jobId: string): Promise<boolean> {
      const job = await queue.getJob(jobId);
      return job != null;
    },
  };
}

export type ReconcileOutcome =
  // One of the required conditions didn't hold — nothing was touched.
  | { action: "not_eligible"; reason: string }
  // The conditional claim UPDATE matched zero rows: the job had already
  // moved past the expected status by the time we tried to claim it
  // (a legitimate concurrent transition won the race). Nothing was
  // touched, and this is not an error — it's the mechanism working as
  // intended.
  | { action: "claim_lost_race" }
  // The claim UPDATE matched and the refund call returned true — fully
  // reconciled, nothing further to do for this job.
  | { action: "reconciled"; refunded: true }
  // The claim UPDATE matched, but the refund call itself failed or
  // returned an unexpected false. The job's status IS now "failed" with
  // reconciled_at set — but reservation_refunded_at is still null, which
  // is exactly what makes this retryable (see retryPendingRefunds below):
  // reconciled_at only ever records "this row's status was claimed," never
  // "the refund is guaranteed," so a later pass can find and retry it
  // without needing to re-run the eligibility checks that already passed.
  | { action: "reconciled_refund_pending"; refunded: false };

function isPastMigrationCutoff(job: Job, cutoff: Date | null): boolean {
  if (cutoff === null) return false;
  return new Date(job.created_at) >= cutoff;
}

function isStaleEnough(job: Job, now: Date): boolean {
  return now.getTime() - new Date(job.updated_at).getTime() >= STALE_THRESHOLD_MS;
}

// Calls refund_job_reservation and reports what actually happened.
// rpcError is set ONLY for a genuine call failure (network/DB error) —
// never for a clean `false` return, which means "already refunded by
// something else" and is not this call's failure. That distinction is
// exactly what lets callers below tell "still genuinely unresolved, stay
// retryable" apart from "resolved either way, safe to clear the pending
// marker" without guessing from message text.
async function attemptRefund(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<{ refunded: boolean; rpcError?: string }> {
  const { data, error } = await supabase.rpc("refund_job_reservation", { p_job_id: jobId });
  if (error) {
    return { refunded: false, rpcError: error.message };
  }
  return { refunded: data === true };
}

// Reads every generated-visual object actually present under this job's
// own folder and checks each one against the exact same anchored
// ownership/path validation jobRunner.ts's own cleanup path uses — never a
// looser/broader match. A listing error fails closed (treated as "an
// artifact might exist") rather than risk concluding "confirmed empty"
// from a call that didn't actually succeed.
async function hasGeneratedVisualArtifact(
  supabase: SupabaseClient<Database>,
  upload: Upload,
  job: Job,
): Promise<boolean> {
  const { data, error } = await supabase.storage.from("uploads").list(`${upload.user_id}/generated`);
  if (error) {
    console.error(`[reconcile] could not list Storage for job ${job.id}, treating as not-confirmed-empty:`, error.message);
    return true;
  }
  return (data ?? []).some((entry) =>
    isOwnGeneratedVisualPath(`${upload.user_id}/generated/${entry.name}`, upload.user_id, job.id),
  );
}

// Clears the reconciler-owned pending-refund marker once a job's refund is
// confirmed resolved (whether by this attempt or a prior one). A failure
// here is logged, not thrown or retried immediately — the marker simply
// stays set, and the next retryPendingRefunds pass will find the job
// again, call refund_job_reservation again (which safely reports "already
// refunded" rather than double-applying anything), and try clearing the
// marker again. No credit is ever at risk from this step failing; only
// the bookkeeping is delayed.
async function clearPendingRefundMarker(supabase: SupabaseClient<Database>, jobId: string): Promise<void> {
  const { error } = await supabase.from("jobs").update({ reconciliation_refund_pending_at: null }).eq("id", jobId);
  if (error) {
    console.error(
      `[reconcile] could not clear the pending-refund marker for job ${jobId} (the refund itself is resolved; this will self-heal on a future retry):`,
      error.message,
    );
  }
}

export async function reconcileQueuedJob(
  supabase: SupabaseClient<Database>,
  queueChecker: QueueJobChecker,
  cutoff: Date | null,
  job: Job,
  now: Date = new Date(),
): Promise<ReconcileOutcome> {
  if (!isPastMigrationCutoff(job, cutoff)) return { action: "not_eligible", reason: "historical job (predates migration 0022)" };
  if (job.reconciled_at) return { action: "not_eligible", reason: "already reconciled" };
  if (job.reservation_refunded_at) return { action: "not_eligible", reason: "already refunded" };
  if (!isStaleEnough(job, now)) return { action: "not_eligible", reason: "not old enough" };
  // Discover-phase BullMQ jobs are keyed by the raw job UUID (see
  // src/app/api/jobs/route.ts's enqueue call).
  if (await queueChecker.hasJob(job.id)) return { action: "not_eligible", reason: "expected Redis job still present" };

  return claimAndRefund(supabase, job, "queued");
}

export async function reconcileCuttingJob(
  supabase: SupabaseClient<Database>,
  queueChecker: QueueJobChecker,
  cutoff: Date | null,
  job: Job,
  now: Date = new Date(),
): Promise<ReconcileOutcome> {
  if (!isPastMigrationCutoff(job, cutoff)) return { action: "not_eligible", reason: "historical job (predates migration 0022)" };
  if (job.reconciled_at) return { action: "not_eligible", reason: "already reconciled" };
  if (job.reservation_refunded_at) return { action: "not_eligible", reason: "already refunded" };
  if (!isStaleEnough(job, now)) return { action: "not_eligible", reason: "not old enough" };
  // Transform-phase BullMQ jobs are keyed by a derived id, not the raw
  // UUID (see src/app/api/jobs/[id]/confirm-selection/route.ts).
  if (await queueChecker.hasJob(`${job.id}-transform`)) {
    return { action: "not_eligible", reason: "expected Redis job still present" };
  }

  return claimAndRefund(supabase, job, "cutting");
}

export async function reconcileGeneratingVisualsJob(
  supabase: SupabaseClient<Database>,
  queueChecker: QueueJobChecker,
  cutoff: Date | null,
  job: Job,
  upload: Upload,
  now: Date = new Date(),
): Promise<ReconcileOutcome> {
  if (!isPastMigrationCutoff(job, cutoff)) return { action: "not_eligible", reason: "historical job (predates migration 0022)" };
  if (job.reconciled_at) return { action: "not_eligible", reason: "already reconciled" };
  if (!isStaleEnough(job, now)) return { action: "not_eligible", reason: "not old enough" };
  if (await queueChecker.hasJob(job.id)) return { action: "not_eligible", reason: "expected Redis job still present" };
  // The one condition this state checks that the others don't: a real
  // Storage artifact must never be silently left behind. Any match means
  // manual review/ownership-validated cleanup, never automated deletion
  // or reconciliation — this function stops here, it does not attempt to
  // remove anything itself.
  if (await hasGeneratedVisualArtifact(supabase, upload, job)) {
    return { action: "not_eligible", reason: "matching generated Storage artifact exists — requires manual review" };
  }

  return claimAndRefund(supabase, job, "generating_visuals");
}

// Shared claim-then-refund sequence for all three states. The claim (a
// conditional UPDATE keyed on the exact expected prior status) and the
// refund (a separate RPC call) cannot share one database transaction — the
// claim is this process's own statement against Postgres, the refund is
// an independent round-trip. Ordering the claim FIRST is deliberate: it is
// itself conditional on the job still being in the exact status this
// function expects, so if a legitimate concurrent transition (a worker
// actually picking the job up) wins the race, the claim matches zero rows
// and nothing is refunded or overwritten. Only once the claim has
// genuinely won do we call the refund — and if that refund then fails,
// the job is left exactly in the "reconciliation_refund_pending_at set"
// state that retryPendingRefunds below is built to find and resolve,
// never silently treated as fully done. reconciliation_refund_pending_at
// is set in this same claim UPDATE (alongside reconciled_at) specifically
// so there is never a window where the job is claimed but not yet marked
// as owing a pending refund.
async function claimAndRefund(
  supabase: SupabaseClient<Database>,
  job: Job,
  expectedStatus: Job["status"],
): Promise<ReconcileOutcome> {
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("jobs")
    .update({
      status: "failed",
      error_message: "Processing could not be confirmed and this job appears abandoned. Your credit has been refunded automatically.",
      reconciled_at: nowIso,
      reconciliation_refund_pending_at: nowIso,
    })
    .eq("id", job.id)
    .eq("status", expectedStatus)
    .is("reconciled_at", null)
    .select("id");

  if (claimError) {
    console.error(`[reconcile] claim update failed for job ${job.id}:`, claimError.message);
    return { action: "not_eligible", reason: `claim update failed: ${claimError.message}` };
  }

  if (!claimed || claimed.length === 0) {
    return { action: "claim_lost_race" };
  }

  const { rpcError } = await attemptRefund(supabase, job.id);
  if (rpcError) {
    console.error(`[reconcile] job ${job.id} claimed but refund did not succeed (retryable):`, rpcError);
    return { action: "reconciled_refund_pending", refunded: false };
  }

  // refunded is true, or false-with-no-rpcError (already refunded by
  // something else) — either way the reservation is resolved, so the
  // pending marker is cleared. refunded itself is reported as true in
  // ReconcileOutcome either way: callers care whether the job's credit
  // ends up refunded, not which specific call happened to do it.
  await clearPendingRefundMarker(supabase, job.id);
  return { action: "reconciled", refunded: true };
}

// Finds every job carrying the reconciler's own pending-refund marker
// (reconciliation_refund_pending_at set — never inferred from
// reconciled_at or from the absence of reservation_refunded_at, both of
// which could in principle mean something else for a job this function
// never touched) and retries just the refund step for each — never
// re-running the eligibility checks, since the claim already happened
// exactly once and must not happen again. refund_job_reservation() is
// itself idempotent (0022), so calling it here for a job that was, in the
// meantime, somehow already refunded through another path simply reports
// "already refunded" rather than double-applying anything — and that
// outcome still clears the pending marker, since the job's reservation is
// genuinely resolved either way.
export async function retryPendingRefunds(
  supabase: SupabaseClient<Database>,
  jobs: Job[],
): Promise<Array<{ jobId: string; refunded: boolean; error?: string }>> {
  const results: Array<{ jobId: string; refunded: boolean; error?: string }> = [];
  for (const job of jobs) {
    if (!job.reconciliation_refund_pending_at) continue;

    const { rpcError } = await attemptRefund(supabase, job.id);
    if (rpcError) {
      results.push({ jobId: job.id, refunded: false, error: rpcError });
      continue; // leave the marker set — still retryable on a future pass
    }

    await clearPendingRefundMarker(supabase, job.id);
    results.push({ jobId: job.id, refunded: true });
  }
  return results;
}
