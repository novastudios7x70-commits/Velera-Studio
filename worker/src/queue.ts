import { Redis } from "ioredis";
import { env } from "./lib/env.js";

// Must match src/lib/queue.ts in the Next.js app — that's the producer,
// this package is the consumer.
export const PIPELINE_QUEUE_NAME = "velora-pipeline";

export type PipelineJobPayload =
  | { jobId: string; phase: "discover" }
  | { jobId: string; phase: "transform" }
  | { jobId: string; phase: "reclip"; clipIds: string[]; startSec: number; endSec: number };

export function createRedisConnection() {
  return new Redis(env.redisUrl, { maxRetriesPerRequest: null });
}
