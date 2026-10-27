// Tests for worker/src/reconcile.ts — the conservative stale-job
// reconciliation design, including the two corrections made after design
// review: (1) the historical cutoff is read from a real migration-
// activation record rather than a hardcoded guessed date, and (2) the
// "refund still pending" state is tracked by its own dedicated,
// reconciler-only column instead of being inferred by combining
// reconciled_at with the absence of reservation_refunded_at.
//
// Every function under test is imported directly from the real production
// module, not copied; only the Supabase client and the BullMQ existence
// check are faked, since those are the actual network boundaries.
//
// Scope deliberately mirrors reconcile.ts's own scope: no scheduler is
// exercised here (none exists to test), and no test calls anything that
// would run against a real database or Redis instance.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reconcileQueuedJob,
  reconcileCuttingJob,
  reconcileGeneratingVisualsJob,
  retryPendingRefunds,
  getMigrationCutoff,
  type QueueJobChecker,
} from "./reconcile.js";
import type { Database, Job, Upload } from "./lib/database.types.js";

const USER = "user-1111-1111-1111-111111111111";
const JOB = "job-cccc-cccc-cccc-cccccccccccc";
const UPLOAD: Upload = { user_id: USER } as Upload;

// A fixed "now" and a fixed cutoff, passed explicitly into every call
// below — reconcile.ts no longer hardcodes a cutoff date itself; the
// real activation instant is resolved once (via getMigrationCutoff, also
// tested directly below) and threaded through by the caller.
const CUTOFF = new Date("2026-10-26T00:00:00.000Z");
const NOW = new Date("2026-10-27T00:00:00.000Z");
const OLD_ENOUGH_UPDATED_AT = "2026-10-25T00:00:00.000Z"; // >24h before NOW
const TOO_YOUNG_UPDATED_AT = "2026-10-26T23:30:00.000Z"; // <24h before NOW
const POST_CUTOFF_CREATED_AT = "2026-10-26T12:00:00.000Z"; // after CUTOFF
const PRE_CUTOFF_CREATED_AT = "2026-08-02T00:00:00.000Z"; // before CUTOFF

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: JOB,
    status: "queued",
    created_at: POST_CUTOFF_CREATED_AT,
    updated_at: OLD_ENOUGH_UPDATED_AT,
    reconciled_at: null,
    reservation_refunded_at: null,
    reconciliation_refund_pending_at: null,
    ...overrides,
  } as Job;
}

function makeQueueChecker(hasJobResult: boolean): QueueJobChecker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async hasJob(jobId: string) {
      calls.push(jobId);
      return hasJobResult;
    },
  };
}

type JobsUpdateOutcome = { matches: boolean } | { error: { message: string } };

function makeFakeSupabase(opts: {
  jobsUpdate?: JobsUpdateOutcome;
  refund?: { data: boolean | null; error: { message: string } | null };
  storageList?: { data: { name: string }[] | null; error: { message: string } | null };
  migrationActivation?: { data: { activated_at: string } | null; error: { message: string } | null };
}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const storageListCalls: string[] = [];

  const jobsUpdate: JobsUpdateOutcome = opts.jobsUpdate ?? { matches: true };

  // A single thenable, chainable object reused for every .update() call on
  // "jobs". It supports both real call shapes in reconcile.ts:
  //   .update(payload).eq().eq().is().select()   (the claim)
  //   .update(payload).eq("id", id)               (clearPendingRefundMarker,
  //                                                 awaited directly, no .select())
  // Awaiting it directly (no .select()) always resolves to a successful
  // plain update result — none of the required test cases need the
  // marker-clear update itself to fail, and production code already
  // handles that failure gracefully (logs, self-heals on a later retry).
  const jobsUpdateChain = {
    eq() {
      return jobsUpdateChain;
    },
    is() {
      return jobsUpdateChain;
    },
    async select() {
      if ("error" in jobsUpdate) return { data: null, error: jobsUpdate.error };
      return { data: jobsUpdate.matches ? [{ id: JOB }] : [], error: null };
    },
    then(resolve: (value: { data: null; error: null }) => void, reject: (reason: unknown) => void) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };

  const fakeClient = {
    from(table: string) {
      if (table === "jobs") {
        return {
          update(payload: Record<string, unknown>) {
            updateCalls.push(payload);
            return jobsUpdateChain;
          },
        };
      }
      if (table === "migration_activations") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return opts.migrationActivation ?? { data: { activated_at: CUTOFF.toISOString() }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`fake client: unexpected table "${table}"`);
    },
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return opts.refund ?? { data: true, error: null };
    },
    storage: {
      from() {
        return {
          async list(prefix: string) {
            storageListCalls.push(prefix);
            return opts.storageList ?? { data: [], error: null };
          },
        };
      },
    },
  };

  return {
    supabase: fakeClient as unknown as SupabaseClient<Database>,
    updateCalls,
    rpcCalls,
    storageListCalls,
  };
}

// --- Correction 1: historical cutoff is resolved from a real record, not a hardcoded date ---

test("getMigrationCutoff: resolves the real activated_at from migration_activations", async () => {
  const { supabase } = makeFakeSupabase({ migrationActivation: { data: { activated_at: "2026-10-26T00:00:00.000Z" }, error: null } });
  const cutoff = await getMigrationCutoff(supabase);
  assert.ok(cutoff instanceof Date);
  assert.equal(cutoff?.toISOString(), "2026-10-26T00:00:00.000Z");
});

test("getMigrationCutoff: returns null (never a guessed default) when the row is missing", async () => {
  const { supabase } = makeFakeSupabase({ migrationActivation: { data: null, error: null } });
  const cutoff = await getMigrationCutoff(supabase);
  assert.equal(cutoff, null);
});

test("getMigrationCutoff: returns null on a query error, rather than assuming a cutoff", async () => {
  const { supabase } = makeFakeSupabase({ migrationActivation: { data: null, error: { message: "simulated query failure" } } });
  const cutoff = await getMigrationCutoff(supabase);
  assert.equal(cutoff, null);
});

test("queued: a pre-cutoff (historical) job is ignored even though every other condition holds", async () => {
  const job = makeJob({ status: "queued", created_at: PRE_CUTOFF_CREATED_AT });
  const { supabase, updateCalls, rpcCalls } = makeFakeSupabase({ jobsUpdate: { matches: true } });
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.match(result.action === "not_eligible" ? result.reason : "", /historical/i);
  assert.equal(updateCalls.length, 0);
  assert.equal(rpcCalls.length, 0);
});

test("queued: a post-cutoff eligible job can reconcile", async () => {
  const job = makeJob({ status: "queued", created_at: POST_CUTOFF_CREATED_AT });
  const { supabase, updateCalls, rpcCalls } = makeFakeSupabase({ jobsUpdate: { matches: true }, refund: { data: true, error: null } });
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);

  assert.deepEqual(result, { action: "reconciled", refunded: true });
  assert.equal(updateCalls.length, 2, "the claim update plus the pending-marker clear once the refund is confirmed");
  assert.equal(rpcCalls.length, 1);
});

test("queued: a null cutoff (could not be resolved) is treated as historical — fails safe, never lets everything through", async () => {
  const job = makeJob({ status: "queued", created_at: POST_CUTOFF_CREATED_AT });
  const { supabase, updateCalls } = makeFakeSupabase({ jobsUpdate: { matches: true } });
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), null, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

// --- queued: each individual condition failing -> no action ---

test("queued: too young -> not_eligible, no DB write attempted", async () => {
  const job = makeJob({ status: "queued", updated_at: TOO_YOUNG_UPDATED_AT });
  const { supabase, updateCalls } = makeFakeSupabase({});
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

test("queued: expected Redis job still present -> not_eligible, no DB write attempted", async () => {
  const job = makeJob({ status: "queued" });
  const { supabase, updateCalls } = makeFakeSupabase({});
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(true), CUTOFF, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

test("queued: already refunded -> not_eligible, no DB write attempted", async () => {
  const job = makeJob({ status: "queued", reservation_refunded_at: "2026-10-25T01:00:00.000Z" });
  const { supabase, updateCalls } = makeFakeSupabase({});
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

test("queued: already reconciled -> not_eligible, no DB write attempted", async () => {
  const job = makeJob({ status: "queued", reconciled_at: "2026-10-25T01:00:00.000Z" });
  const { supabase, updateCalls } = makeFakeSupabase({});
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

// --- the conditional update racing a concurrent legitimate transition ---

test("queued: conditional update matches zero rows -> claim_lost_race, no refund attempted", async () => {
  const job = makeJob({ status: "queued" });
  const { supabase, rpcCalls } = makeFakeSupabase({ jobsUpdate: { matches: false } });
  const result = await reconcileQueuedJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);

  assert.deepEqual(result, { action: "claim_lost_race" });
  assert.equal(rpcCalls.length, 0, "a lost claim must never attempt a refund");
});

// --- cutting: same shape, transform-keyed Redis lookup ---

test("cutting: all conditions true -> claims and refunds, checked against the transform-phase job id", async () => {
  const job = makeJob({ status: "cutting" });
  const { supabase, updateCalls, rpcCalls } = makeFakeSupabase({ jobsUpdate: { matches: true }, refund: { data: true, error: null } });
  const checker = makeQueueChecker(false);

  const result = await reconcileCuttingJob(supabase, checker, CUTOFF, job, NOW);

  assert.deepEqual(result, { action: "reconciled", refunded: true });
  assert.deepEqual(checker.calls, [`${JOB}-transform`], "cutting must check the derived transform-phase id, not the raw job id");
  assert.equal(updateCalls.length, 2, "the claim update plus the pending-marker clear once the refund is confirmed");
  assert.equal(rpcCalls.length, 1);
});

test("cutting: expected transform-phase Redis job still present -> not_eligible", async () => {
  const job = makeJob({ status: "cutting" });
  const { supabase, updateCalls } = makeFakeSupabase({});
  const result = await reconcileCuttingJob(supabase, makeQueueChecker(true), CUTOFF, job, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

test("cutting: too young -> not_eligible", async () => {
  const job = makeJob({ status: "cutting", updated_at: TOO_YOUNG_UPDATED_AT });
  const { supabase } = makeFakeSupabase({});
  const result = await reconcileCuttingJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);
  assert.equal(result.action, "not_eligible");
});

test("cutting: historical (pre-cutoff) job -> not_eligible", async () => {
  const job = makeJob({ status: "cutting", created_at: PRE_CUTOFF_CREATED_AT });
  const { supabase } = makeFakeSupabase({ jobsUpdate: { matches: true } });
  const result = await reconcileCuttingJob(supabase, makeQueueChecker(false), CUTOFF, job, NOW);
  assert.equal(result.action, "not_eligible");
});

// --- generating_visuals: Storage artifact check ---

test("generating_visuals: no Redis job, no Storage artifact -> claims and refunds", async () => {
  const job = makeJob({ status: "generating_visuals" });
  const { supabase, updateCalls, rpcCalls, storageListCalls } = makeFakeSupabase({
    jobsUpdate: { matches: true },
    refund: { data: true, error: null },
    storageList: { data: [], error: null },
  });

  const result = await reconcileGeneratingVisualsJob(supabase, makeQueueChecker(false), CUTOFF, job, UPLOAD, NOW);

  assert.deepEqual(result, { action: "reconciled", refunded: true });
  assert.deepEqual(storageListCalls, [`${USER}/generated`]);
  assert.equal(updateCalls.length, 2, "the claim update plus the pending-marker clear once the refund is confirmed");
  assert.equal(rpcCalls.length, 1);
});

test("generating_visuals: a matching generated Storage artifact exists -> not_eligible, never auto-cleaned-up or reconciled", async () => {
  const job = makeJob({ status: "generating_visuals" });
  const { supabase, updateCalls, rpcCalls } = makeFakeSupabase({
    jobsUpdate: { matches: true },
    storageList: { data: [{ name: `${JOB}.mp4` }], error: null },
  });

  const result = await reconcileGeneratingVisualsJob(supabase, makeQueueChecker(false), CUTOFF, job, UPLOAD, NOW);

  assert.equal(result.action, "not_eligible");
  assert.match(result.action === "not_eligible" ? result.reason : "", /manual review/i);
  assert.equal(updateCalls.length, 0, "must never touch the job row when an artifact is present");
  assert.equal(rpcCalls.length, 0, "must never refund when an artifact is present");
});

test("generating_visuals: historical (pre-cutoff) job -> not_eligible even with no Redis job and no artifact", async () => {
  const job = makeJob({ status: "generating_visuals", created_at: PRE_CUTOFF_CREATED_AT });
  const { supabase, updateCalls } = makeFakeSupabase({ jobsUpdate: { matches: true }, storageList: { data: [], error: null } });
  const result = await reconcileGeneratingVisualsJob(supabase, makeQueueChecker(false), CUTOFF, job, UPLOAD, NOW);

  assert.equal(result.action, "not_eligible");
  assert.equal(updateCalls.length, 0);
});

// --- Correction 2: the pending-refund marker is unambiguous and reconciler-only ---

test("1. a reconciler-created pending refund is retried", async () => {
  const pendingJob = makeJob({
    status: "failed",
    reconciled_at: "2026-10-26T01:00:00.000Z",
    reconciliation_refund_pending_at: "2026-10-26T01:00:00.000Z",
    reservation_refunded_at: null,
  });
  const { supabase, rpcCalls, updateCalls } = makeFakeSupabase({ refund: { data: true, error: null } });

  const results = await retryPendingRefunds(supabase, [pendingJob]);

  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0], { name: "refund_job_reservation", args: { p_job_id: JOB } });
  assert.deepEqual(results, [{ jobId: JOB, refunded: true }]);
  // The pending marker must be explicitly cleared, not merely implied.
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].reconciliation_refund_pending_at, null);
});

test("2. an already-refunded job (no pending marker set) is ignored", async () => {
  const alreadyRefunded = makeJob({
    status: "failed",
    reconciled_at: "2026-10-26T01:00:00.000Z",
    reconciliation_refund_pending_at: null,
    reservation_refunded_at: "2026-10-26T01:00:01.000Z",
  });
  const { supabase, rpcCalls } = makeFakeSupabase({ refund: { data: true, error: null } });

  const results = await retryPendingRefunds(supabase, [alreadyRefunded]);

  assert.equal(rpcCalls.length, 0);
  assert.deepEqual(results, []);
});

test("3. an organically failed job is ignored, even though reconciled_at is (hypothetically) set — only the dedicated pending marker controls retry, never reconciled_at alone", async () => {
  // Models the exact ambiguity the correction closes: reconciled_at set,
  // reservation_refunded_at null — which, under the OLD inference rule,
  // would have looked exactly like a pending reconciler refund. With the
  // dedicated marker absent, this job must be left alone.
  const organicFailure = makeJob({
    status: "failed",
    reconciled_at: "2026-10-26T01:00:00.000Z",
    reconciliation_refund_pending_at: null,
    reservation_refunded_at: null,
  });
  const { supabase, rpcCalls } = makeFakeSupabase({ refund: { data: true, error: null } });

  const results = await retryPendingRefunds(supabase, [organicFailure]);

  assert.equal(rpcCalls.length, 0, "a job without the dedicated pending marker must never be retried, however reconciled_at/reservation_refunded_at look");
  assert.deepEqual(results, []);
});

test("4. a refund RPC failure leaves the job retryable — marker is not cleared, job is reported as still unresolved", async () => {
  const pendingJob = makeJob({
    status: "failed",
    reconciled_at: "2026-10-26T01:00:00.000Z",
    reconciliation_refund_pending_at: "2026-10-26T01:00:00.000Z",
    reservation_refunded_at: null,
  });
  const { supabase, updateCalls } = makeFakeSupabase({ refund: { data: null, error: { message: "simulated refund RPC failure" } } });

  const results = await retryPendingRefunds(supabase, [pendingJob]);

  assert.deepEqual(results, [{ jobId: JOB, refunded: false, error: "simulated refund RPC failure" }]);
  assert.equal(updateCalls.length, 0, "the pending marker must not be cleared when the refund itself failed");
});

test("5. a successful retry is no longer returned as pending on a subsequent pass", async () => {
  const pendingJob = makeJob({
    status: "failed",
    reconciled_at: "2026-10-26T01:00:00.000Z",
    reconciliation_refund_pending_at: "2026-10-26T01:00:00.000Z",
    reservation_refunded_at: null,
  });
  const { supabase } = makeFakeSupabase({ refund: { data: true, error: null } });

  const firstPass = await retryPendingRefunds(supabase, [pendingJob]);
  assert.deepEqual(firstPass, [{ jobId: JOB, refunded: true }]);

  // Simulate a second reconciliation pass reading the job fresh from the
  // database: the marker is now null, so it's correctly excluded without
  // needing to call the refund RPC again.
  const resolvedJob = makeJob({ ...pendingJob, reconciliation_refund_pending_at: null, reservation_refunded_at: "2026-10-26T02:00:00.000Z" });
  const { supabase: supabase2, rpcCalls: rpcCalls2 } = makeFakeSupabase({ refund: { data: true, error: null } });
  const secondPass = await retryPendingRefunds(supabase2, [resolvedJob]);

  assert.equal(rpcCalls2.length, 0);
  assert.deepEqual(secondPass, []);
});

test("retryPendingRefunds: a clean 'already refunded' response (no RPC error) still clears the marker and reports resolved", async () => {
  const pendingJob = makeJob({
    status: "failed",
    reconciled_at: "2026-10-26T01:00:00.000Z",
    reconciliation_refund_pending_at: "2026-10-26T01:00:00.000Z",
    reservation_refunded_at: null,
  });
  // refund_job_reservation returns false with no error — e.g. the
  // reservation was already refunded through some other path.
  const { supabase, updateCalls } = makeFakeSupabase({ refund: { data: false, error: null } });

  const results = await retryPendingRefunds(supabase, [pendingJob]);

  assert.deepEqual(results, [{ jobId: JOB, refunded: true }]);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].reconciliation_refund_pending_at, null);
});
