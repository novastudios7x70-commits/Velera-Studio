import { Worker } from "bullmq";
import { assertEnv, env } from "./lib/env.js";
import { PIPELINE_QUEUE_NAME, createRedisConnection, type PipelineJobPayload } from "./queue.js";
import { processJob } from "./jobRunner.js";

assertEnv();

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

process.on("SIGTERM", async () => {
  console.log("[worker] shutting down");
  await worker.close();
  process.exit(0);
});

console.log(`[worker] listening on queue "${PIPELINE_QUEUE_NAME}" (concurrency=${env.workerConcurrency})`);
