import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const PIPELINE_QUEUE_NAME = "velora-pipeline";

export interface PipelineJobPayload {
  jobId: string;
  // "discover" runs analysis + segment selection and stops at
  // awaiting_selection; "transform" (enqueued by the confirm-selection
  // route) resumes rendering only the confirmed segments.
  phase: "discover" | "transform";
}

let connection: Redis | null = null;
let queue: Queue<PipelineJobPayload> | null = null;

function getConnection() {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  }
  return connection;
}

// Producer side only — the Next.js app enqueues jobs here, it never
// processes them. The worker/ package holds the matching Worker consumer.
export function getPipelineQueue() {
  if (!queue) {
    queue = new Queue<PipelineJobPayload>(PIPELINE_QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}
