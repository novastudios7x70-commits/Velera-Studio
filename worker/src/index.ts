import { Worker } from "bullmq";
import { assertEnv, env } from "./lib/env.js";
import { PIPELINE_QUEUE_NAME, createRedisConnection, type PipelineJobPayload } from "./queue.js";
import { processJob } from "./jobRunner.js";

assertEnv();

// Stateless by design: every job's state lives in Supabase (job/clip rows,
// storage), never in this process's memory, so any number of worker
// instances can run against the same queue — scale by adding replicas, not
// by making a single worker faster.
const worker = new Worker<PipelineJobPayload>(
  PIPELINE_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] picked up job ${job.data.jobId}`);
    await processJob(job.data.jobId);
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
