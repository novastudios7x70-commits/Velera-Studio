import { env } from "../lib/env.js";
import type { ContentType, VisualStyle } from "../lib/database.types.js";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Generate-visuals path (Step 2.5) — feature-flagged behind
 * GENERATE_VISUALS_ENABLED (see CLAUDE.md: Higgsfield's redistribution
 * licensing for this product is still being finalized). The job runner never
 * calls this unless the flag is on, and it's also re-checked here so a
 * misconfigured caller can't bypass the gate.
 *
 * Uses Higgsfield's async submit → poll → download job pattern. Confirm the
 * exact endpoint paths/payload shape against Higgsfield's current API
 * reference before going live — this integration was built against their
 * documented generation-job contract, but no live credentials were available
 * to exercise it end-to-end in this environment.
 */
export async function generateVisual(params: {
  contentType: ContentType;
  moodDescription: string | null;
  style: VisualStyle | null;
  durationSeconds: number;
}): Promise<{ videoUrl: string }> {
  if (!env.generateVisualsEnabled) {
    throw new Error("Generate-visuals path is disabled (GENERATE_VISUALS_ENABLED=false)");
  }
  if (!env.higgsfieldApiKey) {
    throw new Error("HIGGSFIELD_API_KEY is not configured");
  }

  const prompt = buildPrompt(params);

  const submitRes = await fetch(`${env.higgsfieldApiUrl}/v1/video/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.higgsfieldApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: "9:16",
      duration_seconds: Math.min(Math.max(Math.round(params.durationSeconds), 10), 15),
    }),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`Higgsfield generation request failed (${submitRes.status}): ${body}`);
  }

  const { job_id: jobId } = (await submitRes.json()) as { job_id: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${env.higgsfieldApiUrl}/v1/video/jobs/${jobId}`, {
      headers: { authorization: `Bearer ${env.higgsfieldApiKey}` },
    });
    if (!statusRes.ok) {
      throw new Error(`Higgsfield status check failed (${statusRes.status})`);
    }
    const status = (await statusRes.json()) as { status: "queued" | "processing" | "completed" | "failed"; output_url?: string; error?: string };

    if (status.status === "completed" && status.output_url) {
      return { videoUrl: status.output_url };
    }
    if (status.status === "failed") {
      throw new Error(`Higgsfield generation failed: ${status.error ?? "unknown error"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Higgsfield generation timed out");
}

function buildPrompt(params: { contentType: ContentType; moodDescription: string | null; style: VisualStyle | null }) {
  const parts: string[] = [];
  if (params.contentType === "music") {
    parts.push("Abstract, rhythmic visuals suited to a music short-form clip.");
  } else {
    parts.push("Clean, engaging b-roll suited to a spoken/talking-head short-form clip.");
  }
  if (params.moodDescription) parts.push(`Mood: ${params.moodDescription}.`);
  if (params.style?.genre) parts.push(`Genre reference: ${params.style.genre}.`);
  if (params.style?.color) parts.push(`Color palette: ${params.style.color}.`);
  parts.push("Vertical 9:16 framing, no text or watermarks, cinematic quality.");
  return parts.join(" ");
}
