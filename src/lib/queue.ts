import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const PIPELINE_QUEUE_NAME = "velora-pipeline";

// "discover" runs analysis + segment selection and stops at
// awaiting_selection; "transform" (enqueued by the confirm-selection route)
// resumes rendering only the confirmed segments; "reclip" (enqueued by
// POST /api/clips/[id]/re-render) re-renders one already-rendered moment's
// clip rows at new start/end bounds, leaving the original file untouched
// until the new render + upload both succeed.
export type PipelineJobPayload =
  | { jobId: string; phase: "discover" }
  | { jobId: string; phase: "transform" }
  | { jobId: string; phase: "reclip"; clipIds: string[]; startSec: number; endSec: number };

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
