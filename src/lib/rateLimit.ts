import { Redis } from "ioredis";

// Separate connection from src/lib/queue.ts's BullMQ producer connection —
// that one is configured specifically for BullMQ's requirements
// (maxRetriesPerRequest: null); this is a plain counter, no special config
// needed.
let connection: Redis | null = null;
function getConnection() {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!);
  }
  return connection;
}

const JOB_LIMIT = 10;
const JOB_WINDOW_SECONDS = 60 * 60 * 24; // covers one Discover session generously
const USER_LIMIT = 30;
const USER_WINDOW_SECONDS = 60 * 60;

async function checkAndIncrement(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getConnection();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

/**
 * Lightweight abuse guard for the discover-query endpoint — a job-scoped cap
 * (generous for real exploratory use on one upload) plus a per-user hourly
 * cap (guards against hammering the endpoint across many jobs). Not a
 * billing concept — the query itself never touches clip credits.
 */
export async function checkDiscoverQueryRateLimit(
  userId: string,
  jobId: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const jobOk = await checkAndIncrement(`discover-query:job:${jobId}`, JOB_LIMIT, JOB_WINDOW_SECONDS);
  if (!jobOk) {
    return { allowed: false, reason: "Too many requests for this job — try selecting moments manually." };
  }
  const userOk = await checkAndIncrement(`discover-query:user:${userId}`, USER_LIMIT, USER_WINDOW_SECONDS);
  if (!userOk) {
    return { allowed: false, reason: "Too many requests right now — please try again in a bit." };
  }
  return { allowed: true };
}
