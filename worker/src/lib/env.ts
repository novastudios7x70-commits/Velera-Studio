const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
  "ASSEMBLYAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  redisUrl: process.env.REDIS_URL!,
  assemblyAiApiKey: process.env.ASSEMBLYAI_API_KEY!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
  generateVisualsEnabled: process.env.GENERATE_VISUALS_ENABLED === "true",
  higgsfieldApiKey: process.env.HIGGSFIELD_API_KEY,
  higgsfieldApiUrl: process.env.HIGGSFIELD_API_URL || "https://platform.higgsfield.ai",
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 2),
};
