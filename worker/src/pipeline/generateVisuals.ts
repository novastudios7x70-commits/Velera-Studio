import { env } from "../lib/env.js";
import type { ContentType, VisualStyle } from "../lib/database.types.js";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

const IMAGE_MODEL_ID = process.env.HIGGSFIELD_IMAGE_MODEL || "higgsfield-ai/soul/standard";
const VIDEO_MODEL_ID = process.env.HIGGSFIELD_VIDEO_MODEL || "higgsfield-ai/dop/standard";

/**
 * Generate-visuals path (Step 2.5) — feature-flagged behind
 * GENERATE_VISUALS_ENABLED (see CLAUDE.md: Higgsfield's redistribution
 * licensing for this product is still being finalized).
 *
 * Confirmed against Higgsfield's own API docs (docs.higgsfield.ai):
 *   - base URL: https://platform.higgsfield.ai
 *   - submit: POST {baseURL}/{model_id} — model_id (e.g.
 *     "higgsfield-ai/soul/standard") goes directly in the URL path, body is
 *     flat JSON (no wrapper object)
 *   - auth header: "Authorization: Key {key_id}:{key_secret}" — a two-part
 *     credential, not a single API key
 *   - status polling: GET {baseURL}/requests/{request_id}/status
 *   - completed response has top-level "images": [{ url }] (for image
 *     models) and/or "video": { url } (for video models)
 * Higgsfield has no direct text-to-video model — every video model is
 * image-to-video. So this is a real two-step pipeline: generate a still
 * image from the mood/style prompt, then animate that image.
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

  const scenePrompt = buildScenePrompt(params);
  const motionPrompt = buildMotionPrompt(params);
  const duration = Math.min(Math.max(Math.round(params.durationSeconds), 3), 10);

  const imageResult = await submitAndPoll(IMAGE_MODEL_ID, {
    prompt: scenePrompt,
    aspect_ratio: "9:16",
    resolution: "720p",
  });
  const imageUrl = imageResult.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error(`Higgsfield image generation completed but returned no image URL: ${JSON.stringify(imageResult).slice(0, 500)}`);
  }

  const videoResult = await submitAndPoll(VIDEO_MODEL_ID, {
    image_url: imageUrl,
    prompt: motionPrompt,
    duration,
  });
  const videoUrl = videoResult.video?.url;
  if (!videoUrl) {
    throw new Error(`Higgsfield video generation completed but returned no video URL: ${JSON.stringify(videoResult).slice(0, 500)}`);
  }

  return { videoUrl };
}

type HiggsfieldCompletedResponse = {
  status: string;
  images?: { url: string }[];
  video?: { url: string };
};

async function submitAndPoll(modelId: string, body: Record<string, unknown>): Promise<HiggsfieldCompletedResponse> {
  const authHeader = `Key ${env.higgsfieldKeyId}:${env.higgsfieldKeySecret}`;

  const submitRes = await fetch(`${env.higgsfieldApiUrl}/${modelId}`, {
    method: "POST",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text().catch(() => "");
    throw new Error(`Higgsfield request to ${modelId} failed (${submitRes.status}): ${errBody.slice(0, 500)}`);
  }

  const submitJson = (await submitRes.json()) as { request_id?: string };
  const requestId = submitJson.request_id;
  if (!requestId) {
    throw new Error(`Higgsfield submit response for ${modelId} had no request_id: ${JSON.stringify(submitJson).slice(0, 500)}`);
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${env.higgsfieldApiUrl}/requests/${requestId}/status`, {
      headers: { authorization: authHeader },
    });
    if (!statusRes.ok) {
      const errBody = await statusRes.text().catch(() => "");
      throw new Error(`Higgsfield status check for ${modelId} failed (${statusRes.status}): ${errBody.slice(0, 500)}`);
    }
    const statusJson = (await statusRes.json()) as HiggsfieldCompletedResponse;

    if (statusJson.status === "completed") return statusJson;
    if (statusJson.status === "failed" || statusJson.status === "nsfw") {
      throw new Error(`Higgsfield ${modelId} generation ${statusJson.status}: ${JSON.stringify(statusJson).slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Higgsfield ${modelId} generation timed out`);
}

function buildScenePrompt(params: { contentType: ContentType; moodDescription: string | null; style: VisualStyle | null }) {
  const parts: string[] = [];
  // A user-provided description takes priority over the generic scaffolding
  // below — it's the closest thing to direct creative control we offer, so
  // it leads the prompt instead of getting buried after boilerplate.
  if (params.style?.prompt) parts.push(`${params.style.prompt}.`);
  if (params.contentType === "music") {
    parts.push("Abstract, rhythmic scene suited to a music short-form clip.");
  } else {
    parts.push("Clean, engaging b-roll scene suited to a spoken/talking-head short-form clip.");
  }
  if (params.moodDescription) parts.push(`Mood: ${params.moodDescription}.`);
  if (params.style?.genre) parts.push(`Genre reference: ${params.style.genre}.`);
  if (params.style?.color) parts.push(`Color palette: ${params.style.color}.`);
  parts.push("Vertical 9:16 framing, no text or watermarks, cinematic quality, clear focal subject.");
  return parts.join(" ");
}

function buildMotionPrompt(params: { contentType: ContentType; moodDescription: string | null }) {
  const parts: string[] = ["Smooth, subtle cinematic camera motion."];
  if (params.contentType === "music") {
    parts.push("Motion synced to a steady rhythmic pulse.");
  }
  if (params.moodDescription) parts.push(`Mood: ${params.moodDescription}.`);
  return parts.join(" ");
}
