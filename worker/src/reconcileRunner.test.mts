// Tests for worker/src/reconcileRunner.ts — the driver that decides WHICH
// jobs to fetch and WHEN to run a pass, built on top of reconcile.ts's
// already-reviewed, unchanged eligibility rules. Two groups:
//
// 1. runReconciliationPass() tests — candidate/upload/pending-refund
//    queries, dispatch to the right per-status function, per-job failure
//    isolation, and a fatal query failure never throwing. These use a fake
//    Supabase client (no real network/database), same convention as
//    reconcile.test.mts.
// 2. createReconciliationScheduler() tests — scheduling cadence, overlap
//    prevention, and failure handling. These inject a fake `runPass`
//    (never the real one) so they can exercise timing/concurrency without
//    needing a fake database at all.
// 3. Shutdown tests — stop() halting future ticks, awaitIdle() actually
//    waiting for (and never falsely reporting completion of) an in-flight
//    pass, its bounded timeout, and that a queue checker's close() is
//    never called before awaitIdle() resolves — the exact ordering
//    index.ts's SIGTERM handler depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runReconciliationPass, createReconciliationScheduler, MIN_RECONCILE_INTERVAL_MS, type ReconciliationPassSummary } from "./reconcileRunner.js";
import type { QueueJobChecker } from "./reconcile.js";
import type { Database, Job, Upload } from "./lib/database.types.js";

const USER = "user-1111-1111-1111-111111111111";
const NOW = new Date("2026-11-06T00:00:00.000Z");
const OLD_ENOUGH_UPDATED_AT = "2026-11-04T00:00:00.000Z"; // >24h before NOW

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: "job-0000-0000-0000-000000000000",
    upload_id: "upload-0000-0000-0000-000000000000",
    user_id: USER,
    status: "queued",
    created_at: "2026-10-26T12:00:00.000Z",
    updated_at: OLD_ENOUGH_UPDATED_AT,
    reconciled_at: null,
    reservation_refunded_at: null,
    reconciliation_refund_pending_at: null,
    ...overrides,
  } as Job;
}

type JobsSelectOutcome = { data: Job[]; error: null } | { data: null; error: { message: string } };

function makeFakeSupabase(opts: {
  candidates: JobsSelectOutcome;
  pending?: JobsSelectOutcome;
  uploads?: { data: Upload[] | null; error: { message: string } | null };
  jobsUpdateMatches?: boolean;
  refundByJobId?: Record<string, { data: boolean | null; error: { message: string } | null }>;
  storageList?: { data: { name: string }[] | null; error: { message: string } | null };
}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ jobId: string }> = [];
  let jobsSelectCallCount = 0;

  const jobsUpdateChain = {
    eq() {
      return jobsUpdateChain;
    },
    is() {
      return jobsUpdateChain;
    },
    async select() {
      return { data: (opts.jobsUpdateMatches ?? true) ? [{ id: "claimed" }] : [], error: null };
    },
    then(resolve: (v: { data: null; error: null }) => void, reject: (reason: unknown) => void) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };

  const jobsSelectChain = {
    in() {
      return jobsSelectChain;
    },
    is() {
      return jobsSelectChain;
    },
    not() {
      return jobsSelectChain;
    },
    lte() {
      return jobsSelectChain;
    },
    order() {
      return jobsSelectChain;
    },
    async limit() {
      jobsSelectCallCount++;
      // First select on "jobs" per pass is always the candidates query,
      // the second is always the pending-refunds query — matches
      // runReconciliationPass's fixed call order exactly.
      if (jobsSelectCallCount === 1) return opts.candidates;
      return opts.pending ?? { data: [], error: null };
    },
  };

  const uploadsSelectChain = {
    async in() {
      return opts.uploads ?? { data: [], error: null };
    },
  };

  const fakeClient = {
    from(table: string) {
      if (table === "jobs") {
        return {
          select() {
            return jobsSelectChain;
          },
          update(payload: Record<string, unknown>) {
            updateCalls.push(payload);
            return jobsUpdateChain;
          },
        };
      }
      if (table === "uploads") {
        return { select: () => uploadsSelectChain };
      }
      if (table === "migration_activations") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { activated_at: "2020-01-01T00:00:00.000Z" }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`fake client: unexpected table "${table}"`);
    },
    async rpc(_name: string, args: { p_job_id: string }) {
      rpcCalls.push({ jobId: args.p_job_id });
      return opts.refundByJobId?.[args.p_job_id] ?? { data: true, error: null };
    },
    storage: {
      from() {
        return {
          async list() {
            return opts.storageList ?? { data: [], error: null };
          },
        };
      },
    },
  };

  return { supabase: fakeClient as unknown as SupabaseClient<Database>, updateCalls, rpcCalls };
}

function makeQueueChecker(hasJob: (jobId: string) => boolean | Promise<boolean>): QueueJobChecker {
  return { hasJob: async (jobId: string) => hasJob(jobId) };
}

// --- runReconciliationPass ---

test("pass: dispatches each candidate to its matching per-status function and tallies outcomes", async () => {
  const queuedJob = makeJob({ id: "job-queued", status: "queued" });
  const cuttingJob = makeJob({ id: "job-cutting", status: "cutting" });
  const visualsJob = makeJob({ id: "job-visuals", status: "generating_visuals", upload_id: "upload-visuals" });

  const { supabase } = makeFakeSupabase({
    candidates: { data: [queuedJob, cuttingJob, visualsJob], error: null },
    uploads: { data: [{ id: "upload-visuals", user_id: USER } as Upload], error: null },
  });
  // Only the cutting job's derived transform-id Redis check returns true,
  // so it alone comes back not_eligible while the other two reconcile.
  const queueChecker = makeQueueChecker((jobId) => jobId === "job-cutting-transform");

  const summary = await runReconciliationPass(supabase, queueChecker, NOW);

  assert.equal(summary.candidatesChecked, 3);
  assert.equal(summary.reconciled, 2, "queued and generating_visuals jobs should both reconcile");
  assert.equal(summary.notEligible, 1, "the cutting job's expected Redis job is still present");
  assert.equal(summary.jobErrors, 0);
  assert.equal(summary.fatalError, undefined);
});

test("pass: a generating_visuals candidate with no resolvable upload is counted as a job error, not reconciled", async () => {
  const visualsJob = makeJob({ id: "job-visuals", status: "generating_visuals", upload_id: "upload-missing" });
  const { supabase, updateCalls } = makeFakeSupabase({
    candidates: { data: [visualsJob], error: null },
    uploads: { data: [], error: null }, // the referenced upload never comes back
  });

  const summary = await runReconciliationPass(supabase, makeQueueChecker(() => false), NOW);

  assert.equal(summary.jobErrors, 1);
  assert.equal(summary.reconciled, 0);
  assert.equal(updateCalls.length, 0, "a job that fails closed must never reach the claim update");
});

test("pass: a candidates-query failure returns fatalError and touches nothing else", async () => {
  const { supabase, updateCalls, rpcCalls } = makeFakeSupabase({
    candidates: { data: null, error: { message: "simulated connection failure" } },
  });

  const summary = await runReconciliationPass(supabase, makeQueueChecker(() => false), NOW);

  assert.equal(summary.fatalError, "simulated connection failure");
  assert.equal(summary.candidatesChecked, 0);
  assert.equal(updateCalls.length, 0);
  assert.equal(rpcCalls.length, 0);
});

test("pass: one job's unexpected error (e.g. a Redis failure) does not abort the rest of the pass", async () => {
  const brokenJob = makeJob({ id: "job-broken", status: "queued" });
  const healthyJob = makeJob({ id: "job-healthy", status: "queued" });
  const { supabase } = makeFakeSupabase({
    candidates: { data: [brokenJob, healthyJob], error: null },
  });
  const queueChecker = makeQueueChecker((jobId) => {
    if (jobId === "job-broken") throw new Error("simulated Redis failure");
    return false;
  });

  const summary = await runReconciliationPass(supabase, queueChecker, NOW);

  assert.equal(summary.jobErrors, 1);
  assert.equal(summary.reconciled, 1, "the second, healthy job must still be processed");
});

test("pass: pending refunds are retried and tallied separately from newly-claimed jobs", async () => {
  const retriedOk = makeJob({ id: "job-pending-ok", reconciliation_refund_pending_at: "2026-11-05T00:00:00.000Z" });
  const stillPending = makeJob({ id: "job-pending-fail", reconciliation_refund_pending_at: "2026-11-05T00:00:00.000Z" });

  const { supabase, rpcCalls } = makeFakeSupabase({
    candidates: { data: [], error: null },
    pending: { data: [retriedOk, stillPending], error: null },
    refundByJobId: {
      "job-pending-ok": { data: true, error: null },
      "job-pending-fail": { data: null, error: { message: "simulated refund RPC failure" } },
    },
  });

  const summary = await runReconciliationPass(supabase, makeQueueChecker(() => false), NOW);

  assert.equal(rpcCalls.length, 2);
  assert.equal(summary.pendingRefundsRetried, 1);
  assert.equal(summary.pendingRefundsStillPending, 1);
  assert.equal(summary.pendingRefundErrors, 1);
});

test("pass: a pending-refund query failure is logged and skipped, without touching the candidates results already gathered", async () => {
  const queuedJob = makeJob({ id: "job-queued", status: "queued" });
  const { supabase } = makeFakeSupabase({
    candidates: { data: [queuedJob], error: null },
    pending: { data: null, error: { message: "simulated pending-refund query failure" } },
  });

  const summary = await runReconciliationPass(supabase, makeQueueChecker(() => false), NOW);

  assert.equal(summary.fatalError, undefined);
  assert.equal(summary.reconciled, 1, "the candidates query already succeeded and must still be reflected");
  assert.equal(summary.pendingRefundsRetried, 0);
  assert.equal(summary.pendingRefundErrors, 0);
});

// --- createReconciliationScheduler ---

function makeFakeQueueChecker(): QueueJobChecker {
  return { hasJob: async () => false };
}

function makeStubSummary(): ReconciliationPassSummary {
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

test("scheduler: start() runs a pass on each tick at the configured interval", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let callCount = 0;
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    intervalMs: MIN_RECONCILE_INTERVAL_MS,
    runPass: async () => {
      callCount++;
      return makeStubSummary();
    },
  });

  scheduler.start();
  t.mock.timers.tick(MIN_RECONCILE_INTERVAL_MS);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(callCount, 1);

  t.mock.timers.tick(MIN_RECONCILE_INTERVAL_MS);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(callCount, 2);

  scheduler.stop();
  t.mock.timers.tick(MIN_RECONCILE_INTERVAL_MS);
  await Promise.resolve();
  assert.equal(callCount, 2, "no further ticks fire after stop()");
});

test("scheduler: a configured interval below the floor is clamped up to MIN_RECONCILE_INTERVAL_MS", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let callCount = 0;
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    intervalMs: 1000, // far below the floor
    runPass: async () => {
      callCount++;
      return makeStubSummary();
    },
  });

  scheduler.start();
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(callCount, 0, "must not fire at the too-small configured interval");

  t.mock.timers.tick(MIN_RECONCILE_INTERVAL_MS - 1000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(callCount, 1, "fires once the floor interval has actually elapsed");

  scheduler.stop();
});

test("scheduler: overlap prevention — a tick that fires while a pass is still running is skipped", async () => {
  let inFlight = 0;
  let maxConcurrent = 0;
  const resolvers: Array<() => void> = [];

  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    runPass: async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      inFlight--;
      return makeStubSummary();
    },
  });

  const firstCall = scheduler.triggerNow();
  // Give the first call a tick to actually start and set passInFlight.
  await Promise.resolve();
  assert.equal(scheduler.isPassInFlight(), true);

  const secondCall = await scheduler.triggerNow();
  assert.equal(secondCall, null, "a concurrent trigger while a pass is in flight must be skipped, not queued");

  resolvers[0]?.();
  const firstResult = await firstCall;
  assert.notEqual(firstResult, null);
  assert.equal(maxConcurrent, 1, "the pass function must never be invoked twice concurrently");
});

test("scheduler: a pass that throws is caught, reported as null, and never crashes or wedges the scheduler", async () => {
  let callCount = 0;
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    runPass: async () => {
      callCount++;
      if (callCount === 1) throw new Error("simulated unexpected failure");
      return makeStubSummary();
    },
  });

  const firstResult = await scheduler.triggerNow();
  assert.equal(firstResult, null);
  assert.equal(scheduler.isPassInFlight(), false, "the in-flight guard must be released even after a throw");

  const secondResult = await scheduler.triggerNow();
  assert.notEqual(secondResult, null, "a later trigger must still run normally after a prior failure");
});

// --- shutdown: stop(), awaitIdle(), its bounded timeout, and ordering against queueChecker.close() ---

test("shutdown: stop() prevents every future scheduled tick, even one scheduled before any tick has fired", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let callCount = 0;
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    intervalMs: MIN_RECONCILE_INTERVAL_MS,
    runPass: async () => {
      callCount++;
      return makeStubSummary();
    },
  });

  scheduler.start();
  scheduler.stop();
  t.mock.timers.tick(MIN_RECONCILE_INTERVAL_MS * 3);
  await Promise.resolve();
  assert.equal(callCount, 0, "stopping immediately after start must prevent every future tick, not just ones already fired once");
});

test("shutdown: awaitIdle() resolves immediately when nothing is running", async () => {
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    runPass: async () => makeStubSummary(),
  });

  const outcome = await scheduler.awaitIdle(1000);
  assert.equal(outcome, "idle");
});

test("shutdown: awaitIdle() waits for an active pass to actually finish before resolving", async () => {
  const resolvers: Array<() => void> = [];
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    runPass: async () => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      return makeStubSummary();
    },
  });

  const passPromise = scheduler.triggerNow();
  await Promise.resolve();
  assert.equal(scheduler.isPassInFlight(), true);

  let idleSettled = false;
  const idlePromise = scheduler.awaitIdle(5000).then((outcome) => {
    idleSettled = true;
    return outcome;
  });

  // Give awaitIdle every chance to resolve prematurely before the pass
  // actually finishes — it must not.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(idleSettled, false, "awaitIdle must not resolve while the pass is still running");

  resolvers[0]?.();
  const outcome = await idlePromise;
  assert.equal(outcome, "idle");
  assert.equal(idleSettled, true);
  await passPromise;
});

test("shutdown: awaitIdle() times out on a bounded wait and never reports a still-running pass as finished", async () => {
  let passFinished = false;
  const resolvers: Array<() => void> = [];
  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker: makeFakeQueueChecker(),
    runPass: async () => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      passFinished = true;
      return makeStubSummary();
    },
  });

  const passPromise = scheduler.triggerNow();
  await Promise.resolve();

  const outcome = await scheduler.awaitIdle(20); // deliberately far shorter than the pass takes to finish

  assert.equal(outcome, "timeout", "a still-running pass must produce a distinct 'timeout' outcome");
  assert.equal(passFinished, false, "the pass must genuinely still be unfinished when the timeout fires — not a race with the real completion");
  assert.equal(scheduler.isPassInFlight(), true, "a timeout must never clear the in-flight flag as if the pass had completed");

  resolvers[0]?.();
  await passPromise;
});

// Both tests below mirror index.ts's actual SIGTERM sequence exactly:
// stop() first, then awaitIdle(), then close() ONLY when that resolved
// "idle" — never unconditionally. An earlier version of this code called
// close() regardless of awaitIdle()'s outcome, which silently contradicted
// its own "never close while a pass is using it" guarantee whenever a pass
// outlived the timeout; these two tests pin down both branches so that
// regression can't recur unnoticed.

test("shutdown: pass finishes before the timeout — awaitIdle() resolves 'idle' and close() runs, strictly after the pass is done", async () => {
  const events: string[] = [];
  const queueChecker: QueueJobChecker & { close(): Promise<void> } = {
    async hasJob() {
      events.push("hasJob");
      return false;
    },
    async close() {
      events.push("close");
    },
  };

  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker,
    runPass: async (_supabase, checker) => {
      events.push("pass-start");
      await checker.hasJob("some-job-id");
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push("pass-end");
      return makeStubSummary();
    },
  });

  const passPromise = scheduler.triggerNow();
  await Promise.resolve(); // let the pass actually start before "shutdown" begins

  // The exact sequence index.ts's SIGTERM handler performs: stop future
  // ticks, wait (bounded) for the active pass, close only on a genuine idle.
  scheduler.stop();
  const idleOutcome = await scheduler.awaitIdle(5000);
  if (idleOutcome === "idle") {
    await queueChecker.close();
  }
  await passPromise;

  assert.equal(idleOutcome, "idle");
  assert.deepEqual(
    events,
    ["pass-start", "hasJob", "pass-end", "close"],
    "close() must run, and only after the pass is done",
  );
});

test("shutdown: pass exceeds the timeout — awaitIdle() resolves 'timeout' and close() must NOT be called while the pass may still be running", async () => {
  const events: string[] = [];
  const resolvers: Array<() => void> = [];
  const queueChecker: QueueJobChecker & { close(): Promise<void> } = {
    async hasJob() {
      events.push("hasJob");
      return false;
    },
    async close() {
      events.push("close");
    },
  };

  const scheduler = createReconciliationScheduler({
    getSupabase: () => ({} as SupabaseClient<Database>),
    queueChecker,
    runPass: async (_supabase, checker) => {
      events.push("pass-start");
      await checker.hasJob("some-job-id");
      // Never resolves on its own within the test's short awaitIdle bound
      // below — simulates a pass that's still genuinely running when the
      // shutdown timeout fires.
      await new Promise<void>((resolve) => resolvers.push(resolve));
      events.push("pass-end");
      return makeStubSummary();
    },
  });

  const passPromise = scheduler.triggerNow();
  await Promise.resolve();

  scheduler.stop();
  const idleOutcome = await scheduler.awaitIdle(20); // deliberately shorter than the pass takes
  if (idleOutcome === "idle") {
    await queueChecker.close();
  }

  assert.equal(idleOutcome, "timeout");
  assert.ok(!events.includes("close"), "close() must never be called while awaitIdle() reports the pass as still unresolved");
  assert.ok(events.includes("hasJob"), "the pass must have genuinely started and reached the checker before the timeout fired");
  assert.equal(scheduler.isPassInFlight(), true, "the pass is still actually running at this point, not falsely marked done");

  // Let the still-running pass actually finish and clean up, so it doesn't
  // leak into a later test.
  resolvers[0]?.();
  await passPromise;
  assert.ok(!events.includes("close"), "finishing late must not retroactively trigger the close() that shutdown already skipped");
});
