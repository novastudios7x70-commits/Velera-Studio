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
 * Built against Higgsfield's official SDK repos (higgsfield-ai/higgsfield-js,
 * higgsfield-ai/higgsfield-client) rather than the (blocked-from-fetch) docs
 * site, since those are the most authoritative source available:
 *   - base URL: https://platform.higgsfield.ai
 *   - auth header: "Authorization: Key KEY_ID:KEY_SECRET" — a two-part
 *     credential (Key ID + Key Secret from the Higgsfield dashboard), not a
 *     single API key
 *   - status polling: /requests/{request_id}/status
 *   - submit request body is wrapped in an `input` object
 * The one thing those repos don't show is the exact text-to-video endpoint
 * path/model name (their public examples are all image-to-video) — that part
 * is still a best guess, kept overridable via HIGGSFIELD_T2V_MODEL so it's a
 * config change, not a redeploy, if it turns out wrong.
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
  if (!env.higgsfieldKeyId || !env.higgsfieldKeySecret) {
    throw new Error("HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET are not configured");
  }

  const authHeader = `Key ${env.higgsfieldKeyId}:${env.higgsfieldKeySecret}`;
  const prompt = buildPrompt(params);
  const model = process.env.HIGGSFIELD_T2V_MODEL || "seedance-v2.0-t2v";

  const submitRes = await fetch(`${env.higgsfieldApiUrl}/v1/text2video/${model}`, {
    method: "POST",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: {
        model,
        prompt,
        aspect_ratio: "9:16",
        duration: Math.min(Math.max(Math.round(params.durationSeconds), 10), 15),
      },
    }),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`Higgsfield generation request failed (${submitRes.status}): ${body.slice(0, 500)}`);
  }

  const submitJson = (await submitRes.json()) as Record<string, unknown>;
  const requestId = (submitJson.request_id ?? submitJson.id ?? submitJson.job_id) as string | undefined;
  if (!requestId) {
    throw new Error(`Higgsfield submit response had no recognizable request id: ${JSON.stringify(submitJson).slice(0, 500)}`);
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${env.higgsfieldApiUrl}/requests/${requestId}/status`, {
      headers: { authorization: authHeader },
    });
    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => "");
      throw new Error(`Higgsfield status check failed (${statusRes.status}): ${body.slice(0, 500)}`);
    }
    const statusJson = (await statusRes.json()) as Record<string, unknown>;
    const status = String(statusJson.status ?? "").toLowerCase();

    if (status === "completed") {
      const outputUrl = extractOutputUrl(statusJson);
      if (!outputUrl) {
        throw new Error(`Higgsfield job completed but no output URL found: ${JSON.stringify(statusJson).slice(0, 500)}`);
      }
      return { videoUrl: outputUrl };
    }
    if (status === "failed" || status === "nsfw") {
      throw new Error(`Higgsfield generation ${status}: ${JSON.stringify(statusJson).slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Higgsfield generation timed out");
}

/** The completed-job response shape isn't confirmed, so check the common field names an API like this would plausibly use. */
function extractOutputUrl(statusJson: Record<string, unknown>): string | null {
  const direct = statusJson.output_url ?? statusJson.video_url ?? statusJson.url;
  if (typeof direct === "string") return direct;

  const output = statusJson.output as Record<string, unknown> | undefined;
  if (output) {
    const nested = output.url ?? output.video_url;
    if (typeof nested === "string") return nested;
    if (Array.isArray(output.videos) && typeof output.videos[0]?.url === "string") return output.videos[0].url;
  }

  const result = statusJson.result as Record<string, unknown> | undefined;
  if (result && typeof result.url === "string") return result.url;

  return null;
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
