import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMigrationCutoff,
  reconcileQueuedJob,
  reconcileCuttingJob,
  reconcileGeneratingVisualsJob,
  retryPendingRefunds,
  STALE_THRESHOLD_MS,
  type QueueJobChecker,
  type ReconcileOutcome,
} from "./reconcile.js";
import type { Database, Job, Upload } from "./lib/database.types.js";

// The driver reconcile.ts itself deliberately does not provide (see its own
// header comment): finds candidate jobs and invokes the existing,
// already-reviewed per-status functions unchanged. This module adds no new
// eligibility rule — every decision about whether a job may be touched
// still lives entirely in reconcile.ts. This file only decides WHICH jobs
// to fetch and feed to those functions, and on what cadence.

// Bounds how many rows a single pass will ever fetch/touch. Deliberately
// conservative given STALE_THRESHOLD_MS (24h): a healthy system should have
// very few rows matching at any one time, so this cap exists purely as a
// backstop against an unexpected backlog, not as a number expected to be
// hit in normal operation.
const MAX_CANDIDATE_JOBS_PER_PASS = 200;
const MAX_PENDING_REFUNDS_PER_PASS = 200;

const RECONCILABLE_STATUSES = ["queued", "cutting", "generating_visuals"] as const;

export interface ReconciliationPassSummary {
  candidatesChecked: number;
  reconciled: number;
  refundPending: number;
  claimLostRace: number;
  notEligible: number;
  jobErrors: number;
  pendingRefundsRetried: number;
  pendingRefundsStillPending: number;
  pendingRefundErrors: number;
  // Set only when the pass could not even fetch its candidate set — every
  // other field stays at its zero default in that case, since nothing
  // downstream ran.
  fatalError?: string;
}

function emptySummary(): ReconciliationPassSummary {
  return {
    candidatesChecked: 0,
    reconciled: 0,
    refundPending: 0,
    claimLostRace: 0,
    notEligible: 0,
    jobErrors: 0,
    pendingRefundsRetried: 0,
    pendingRefundsStillPending: 0,
    pendingRefundErrors: 0,
  };
}

function tallyOutcome(summary: ReconciliationPassSummary, outcome: ReconcileOutcome): void {
  switch (outcome.action) {
    case "reconciled":
      summary.reconciled++;
      break;
    case "reconciled_refund_pending":
      summary.refundPending++;
      break;
    case "claim_lost_race":
      summary.claimLostRace++;
      break;
    case "not_eligible":
      summary.notEligible++;
      break;
  }
}

// One reconciliation pass: fetch a bounded set of candidate jobs, dispatch
// each to the matching reconcile.ts function unchanged, then separately
// retry any reconciler-owned pending refunds. Never throws — every
// Supabase call's error is checked explicitly, and each job is handled in
// its own try/catch, so one bad row (or a Redis hiccup from queueChecker)
// can never abort the rest of the pass or escape to the caller. This is
// what lets the scheduler below call this directly from a setInterval
// tick without risking the main BullMQ worker process.
export async function runReconciliationPass(
  supabase: SupabaseClient<Database>,
  queueChecker: QueueJobChecker,
  now: Date = new Date(),
): Promise<ReconciliationPassSummary> {
  const summary = emptySummary();

  const cutoff = await getMigrationCutoff(supabase);

  // Filtering server-side (status, unreconciled, staleness) keeps this
  // query bounded on a healthy table instead of scanning every row on
  // every pass — isStaleEnough inside reconcile.ts re-checks staleness per
  // job regardless, this is purely to avoid fetching rows that could never
  // be eligible.
  const staleBefore = new Date(now.getTime() - STALE_THRESHOLD_MS).toISOString();

  // A secondary "id" sort key makes the ordering fully stable: without one,
  // rows sharing the exact same updated_at have no guaranteed order across
  // calls, which could in a pathological case keep returning the same
  // 200-row subset of a larger tie and never reach the rest.
  const { data: candidates, error: candidatesError } = await supabase
    .from("jobs")
    .select("*")
    .in("status", RECONCILABLE_STATUSES)
    .is("reconciled_at", null)
    .lte("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_CANDIDATE_JOBS_PER_PASS);

  if (candidatesError) {
    console.error("[reconcile-runner] could not fetch candidate jobs — skipping this pass:", candidatesError.message);
    summary.fatalError = candidatesError.message;
    return summary;
  }

  summary.candidatesChecked = candidates?.length ?? 0;

  // generating_visuals is the one state that needs its upload row too
  // (hasGeneratedVisualArtifact, inside reconcile.ts, needs upload.user_id
  // to check Storage) — fetched once per pass for exactly the jobs that
  // need it, not per job.
  const generatingVisualsJobs = (candidates ?? []).filter((job) => job.status === "generating_visuals");
  const uploadsById = new Map<string, Upload>();
  if (generatingVisualsJobs.length > 0) {
    const uploadIds = [...new Set(generatingVisualsJobs.map((job) => job.upload_id))];
    const { data: uploads, error: uploadsError } = await supabase.from("uploads").select("*").in("id", uploadIds);
    if (uploadsError) {
      console.error("[reconcile-runner] could not fetch uploads for generating_visuals candidates:", uploadsError.message);
    } else {
      for (const upload of uploads ?? []) uploadsById.set(upload.id, upload);
    }
  }

  for (const job of candidates ?? []) {
    try {
      let outcome: ReconcileOutcome;
      if (job.status === "queued") {
        outcome = await reconcileQueuedJob(supabase, queueChecker, cutoff, job, now);
      } else if (job.status === "cutting") {
        outcome = await reconcileCuttingJob(supabase, queueChecker, cutoff, job, now);
      } else {
        const upload = uploadsById.get(job.upload_id);
        if (!upload) {
          // Fails closed, same direction as every other "can't confirm" path
          // in reconcile.ts: no upload resolved means this job is left
          // alone, not treated as safe to reconcile.
          summary.jobErrors++;
          console.error(`[reconcile-runner] job ${job.id}: could not resolve its upload row — leaving it alone this pass`);
          continue;
        }
        outcome = await reconcileGeneratingVisualsJob(supabase, queueChecker, cutoff, job, upload, now);
      }
      tallyOutcome(summary, outcome);
    } catch (err) {
      summary.jobErrors++;
      console.error(
        `[reconcile-runner] job ${job.id}: unexpected error during reconciliation — leaving it alone this pass:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Separate step, same pass: retry refunds the claim step above (or an
  // earlier pass) already marked pending. Never re-runs eligibility — that
  // already happened exactly once in claimAndRefund inside reconcile.ts.
  // Same stable-ordering reasoning as the candidates query above.
  const { data: pendingJobs, error: pendingError } = await supabase
    .from("jobs")
    .select("*")
    .not("reconciliation_refund_pending_at", "is", null)
    .order("reconciliation_refund_pending_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_PENDING_REFUNDS_PER_PASS);

  if (pendingError) {
    console.error("[reconcile-runner] could not fetch pending-refund jobs — skipping retry step this pass:", pendingError.message);
  } else if (pendingJobs && pendingJobs.length > 0) {
    try {
      const results = await retryPendingRefunds(supabase, pendingJobs as Job[]);
      for (const result of results) {
        if (result.error) {
          summary.pendingRefundsStillPending++;
          summary.pendingRefundErrors++;
        } else {
          summary.pendingRefundsRetried++;
        }
      }
    } catch (err) {
      console.error("[reconcile-runner] retryPendingRefunds failed unexpectedly:", err instanceof Error ? err.message : err);
      summary.pendingRefundErrors++;
    }
  }

  // Counts only — never a job id, user id, or any job/upload field — safe
  // to leave at info level in production logs.
  console.log(
    `[reconcile-runner] pass complete — candidates=${summary.candidatesChecked} reconciled=${summary.reconciled} ` +
      `refund_pending=${summary.refundPending} claim_lost_race=${summary.claimLostRace} not_eligible=${summary.notEligible} ` +
      `job_errors=${summary.jobErrors} pending_retried=${summary.pendingRefundsRetried} ` +
      `pending_still_pending=${summary.pendingRefundsStillPending} pending_errors=${summary.pendingRefundErrors}`,
  );

  return summary;
}

// 15 minutes: comfortably below STALE_THRESHOLD_MS (24h) with enormous
// margin, so there's no risk of missing eligible jobs, while never polling
// the database more often than genuinely useful.
export const DEFAULT_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
// Floor applied regardless of configuration — guards against an
// accidental misconfiguration (e.g. a stray "15000" meant to be seconds)
// turning this into aggressive polling.
export const MIN_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

// Bounds how long shutdown will wait for an in-flight pass to finish on its
// own before giving up — long enough for a normal pass (bounded to 200+200
// rows, see above) to complete, short enough that a stuck pass can never
// hold up the rest of the process's shutdown indefinitely.
export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 10 * 1000;

export interface ReconciliationScheduler {
  start(): void;
  stop(): void;
  // Runs one pass immediately, outside the interval — primarily for tests
  // and manual/operator-triggered runs. Subject to the same overlap
  // prevention as a scheduled tick: returns null without doing anything if
  // a pass is already in flight.
  triggerNow(): Promise<ReconciliationPassSummary | null>;
  isPassInFlight(): boolean;
  // Resolves "idle" immediately if nothing is running, or once the
  // currently in-flight pass finishes — whichever comes first relative to
  // timeoutMs, after which it resolves "timeout" instead. "timeout" must
  // never be confused with "idle" by a caller: it means shutdown gave up
  // waiting, not that the pass actually finished — the pass may still be
  // running in the background when this resolves that way.
  awaitIdle(timeoutMs?: number): Promise<"idle" | "timeout">;
}

// Wraps runReconciliationPass in a plain setInterval, entirely independent
// of the BullMQ Worker's own job loop — reconciliation is never itself a
// BullMQ job, so it never competes for worker concurrency slots meant for
// real video processing. A single boolean guard prevents overlapping
// passes (a tick that fires while the previous pass is still running is
// skipped, not queued), and every tick's error is caught here as a final
// backstop on top of runReconciliationPass's own internal error handling,
// so nothing from this scheduler can ever crash the process or interrupt
// the main worker.
export function createReconciliationScheduler(deps: {
  getSupabase: () => SupabaseClient<Database>;
  queueChecker: QueueJobChecker;
  intervalMs?: number;
  now?: () => Date;
  // Injectable seam for tests only — defaults to the real pass function.
  runPass?: typeof runReconciliationPass;
}): ReconciliationScheduler {
  const runPass = deps.runPass ?? runReconciliationPass;
  const intervalMs = Math.max(deps.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS, MIN_RECONCILE_INTERVAL_MS);

  let passInFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // Tracks the currently in-flight pass so awaitIdle() has something to
  // wait on — distinct from the passInFlight boolean, which only answers
  // "is one running," not "give me a handle to wait for it."
  let activePassPromise: Promise<ReconciliationPassSummary | null> | null = null;

  async function runOnce(): Promise<ReconciliationPassSummary | null> {
    if (passInFlight) {
      console.log("[reconcile-runner] skipping this tick — the previous pass is still running");
      return null;
    }
    passInFlight = true;
    const promise = (async () => {
      try {
        const supabase = deps.getSupabase();
        return await runPass(supabase, deps.queueChecker, deps.now ? deps.now() : new Date());
      } catch (err) {
        console.error("[reconcile-runner] reconciliation pass failed unexpectedly:", err instanceof Error ? err.message : err);
        return null;
      } finally {
        passInFlight = false;
        activePassPromise = null;
      }
    })();
    activePassPromise = promise;
    return promise;
  }

  return {
    start() {
      if (timer) return; // already started — idempotent, never double-schedules
      timer = setInterval(() => {
        runOnce().catch(() => {
          // runOnce never actually rejects (it catches internally above);
          // this is purely defensive so a future change there can never
          // turn into an unhandled rejection inside a timer callback.
        });
      }, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    triggerNow() {
      return runOnce();
    },
    isPassInFlight() {
      return passInFlight;
    },
    async awaitIdle(timeoutMs: number = DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS): Promise<"idle" | "timeout"> {
      const current = activePassPromise;
      if (!current) return "idle";

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      const idle = current.then((): "idle" => "idle");

      try {
        // Racing two explicitly-tagged branches (rather than racing the raw
        // pass promise against a timer and inferring the outcome from which
        // one happened to resolve) is what guarantees a timeout can never be
        // mistaken for — or silently reported as — a completed pass.
        return await Promise.race([idle, timeout]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    },
  };
}
