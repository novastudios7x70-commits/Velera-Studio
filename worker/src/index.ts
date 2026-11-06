import { Worker } from "bullmq";
import { assertEnv, env } from "./lib/env.js";
import { PIPELINE_QUEUE_NAME, createRedisConnection, type PipelineJobPayload } from "./queue.js";
import { processJob } from "./jobRunner.js";
import { createBullMqJobChecker } from "./reconcile.js";
import { createAdminClient } from "./lib/supabase.js";
import { createReconciliationScheduler, DEFAULT_RECONCILE_INTERVAL_MS, MIN_RECONCILE_INTERVAL_MS } from "./reconcileRunner.js";

assertEnv();

// TEMPORARY DIAGNOSTIC — remove once the production ELEVENLABS_API_KEY
// investigation is resolved. Logs only a boolean (never the value, length,
// or any derived form) so we can confirm whether this specific running
// process actually sees a non-empty ELEVENLABS_API_KEY, independent of what
// the Railway dashboard shows.
console.log(`[worker] ELEVENLABS_API_KEY present: ${Boolean(env.elevenLabsApiKey)}`);

// TEMPORARY DIAGNOSTIC — logs ONLY the names of env vars containing
// "ELEVENLABS" (case-insensitive), never any value, length, or derived
// data. Distinguishes "Railway isn't injecting the variable at all" from
// "it's injected under a name that doesn't exactly match what the code
// reads" (e.g. a stray character/casing difference invisible in the
// Railway dashboard).
console.log(
  `[worker] ElevenLabs env keys: ${JSON.stringify(Object.keys(process.env).filter((k) => /elevenlabs/i.test(k)))}`,
);

// Diagnostic only — helps confirm at a glance which Supabase project and
// service-role key length this deployment actually booted with, without
// logging the secret itself.
console.log(
  `[worker] supabase url: ${process.env.NEXT_PUBLIC_SUPABASE_URL} | service role key length: ${process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0}`,
);

// Scan every env var this process actually has for any character outside
// Latin-1 (code > 255) — that's exactly what a ByteString-conversion crash
// in fetch's Headers requires, and length checks alone don't catch a 1:1
// character substitution. Reports the variable name, position, and code
// without logging any secret value itself.
for (const [key, value] of Object.entries(process.env)) {
  if (!value) continue;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) {
      console.log(`[worker] non-latin1 char in env var "${key}" at index ${i}: code ${code}`);
    }
  }
}

// Stateless by design: every job's state lives in Supabase (job/clip rows,
// storage), never in this process's memory, so any number of worker
// instances can run against the same queue — scale by adding replicas, not
// by making a single worker faster.
const worker = new Worker<PipelineJobPayload>(
  PIPELINE_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] picked up job ${job.data.jobId} (phase: ${job.data.phase})`);
    await processJob(job.data);
    console.log(`[worker] finished job ${job.data.jobId}`);
  },
  {
    connection: createRedisConnection(),
    concurrency: env.workerConcurrency,
  },
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.data.jobId} failed:`, err.message);
});

// Off by default — this exact pathway (automatically flipping a stale job
// to "failed" and refunding its credit) has never run against production
// data before. Deploying this code does not, by itself, turn it on; an
// operator must explicitly set RECONCILE_ENABLED=true. When enabled, it
// runs as a plain in-process interval on this same long-running process —
// never as a BullMQ job itself, so it never consumes a concurrency slot
// meant for real video processing, and every pass is independently
// wrapped so a database/Redis failure here can never crash this process
// or interrupt the worker above. See reconcileRunner.ts for the full
// scheduling design (overlap prevention, bounded queries, failure
// isolation) and reconcile.ts for the conservative eligibility rules this
// reuses unchanged.
const reconcileEnabled = process.env.RECONCILE_ENABLED === "true";
let reconcileScheduler: ReturnType<typeof createReconciliationScheduler> | null = null;
let reconcileQueueChecker: ReturnType<typeof createBullMqJobChecker> | null = null;

if (reconcileEnabled) {
  const configuredIntervalMs = Number(process.env.RECONCILE_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredIntervalMs) && configuredIntervalMs > 0 ? configuredIntervalMs : DEFAULT_RECONCILE_INTERVAL_MS;
  reconcileQueueChecker = createBullMqJobChecker();
  reconcileScheduler = createReconciliationScheduler({
    getSupabase: createAdminClient,
    queueChecker: reconcileQueueChecker,
    intervalMs,
  });
  reconcileScheduler.start();
  console.log(`[worker] stale-job reconciliation enabled (interval=${Math.max(intervalMs, MIN_RECONCILE_INTERVAL_MS)}ms)`);
} else {
  console.log("[worker] stale-job reconciliation disabled (set RECONCILE_ENABLED=true to enable)");
}

process.on("SIGTERM", async () => {
  console.log("[worker] shutting down");
  // Order matters: stop scheduling new ticks first, then wait (bounded) for
  // whatever pass is already running to actually finish. Closing the
  // reconciliation Redis connection is conditional on that wait having
  // genuinely succeeded — awaitIdle() resolving "timeout" means the pass
  // may still be running and may still be using that connection, so close()
  // is skipped in that case rather than called "anyway." This never
  // produces an indefinite hang: awaitIdle() itself is bounded, and
  // shutdown proceeds to worker.close()/process.exit() either way — on a
  // timeout, the process exit a few lines below tears the leaked
  // connection down at the OS level regardless of whether this code ever
  // called its graceful close().
  reconcileScheduler?.stop();
  if (reconcileScheduler) {
    const idleOutcome = await reconcileScheduler.awaitIdle();
    if (idleOutcome === "idle") {
      await reconcileQueueChecker?.close();
    } else {
      console.error(
        "[worker] a reconciliation pass did not finish within the shutdown timeout — it may still be running and " +
          "still using its Redis connection, so that connection is being left open rather than closed out from " +
          "under it; shutdown is proceeding anyway and the process exit below will terminate it regardless",
      );
    }
  }
  await worker.close();
  process.exit(0);
});

console.log(`[worker] listening on queue "${PIPELINE_QUEUE_NAME}" (concurrency=${env.workerConcurrency})`);
