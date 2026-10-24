import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./lib/supabase.js";
import { env } from "./lib/env.js";
import { transcribeAudio } from "./pipeline/transcribe.js";
import { analyzeAudio } from "./pipeline/audioAnalysis.js";
import { generateVisual, MAX_VISUAL_GENERATIONS_PER_JOB } from "./pipeline/generateVisuals.js";
import { generateVoiceover } from "./pipeline/tts.js";
import { planScenes } from "./pipeline/scenePlanner.js";
import { groupScenesForGeneration, type SceneGenerationGroup } from "./pipeline/sceneGrouping.js";
import { MIN_CLIP_SECONDS, selectSegments } from "./pipeline/selectSegments.js";
import { explainSegments } from "./pipeline/explainSegments.js";
import { buildAssDocument, buildMusicCue, buildWordCues } from "./pipeline/captions.js";
import {
  PINTEREST_TARGET,
  VERTICAL_TARGET,
  extractThumbnail,
  extractThumbnailAt,
  renderClip,
  renderClipWithAudioTrack,
  snapToBeats,
  writeAssFile,
} from "./pipeline/ffmpegRender.js";
import { uploadClipAsset } from "./pipeline/uploadOutputs.js";
import type { Database, Job, Scene, SceneVisual, SelectedSegment, Upload } from "./lib/database.types.js";
import type { PipelineJobPayload } from "./queue.js";

const PLATFORMS_FOR_VERTICAL = ["tiktok", "shorts", "reels", "facebook"] as const;
// Must stay >= selectSegments.ts's MIN_CLIP_SECONDS (12) with real slack —
// too tight a window leaves the segment selector almost no room to find a
// segment that's both long enough and fully inside the window, and this
// project's confirmed the empty-result failure mode firsthand. The
// generated visual clip itself loops (see renderClipWithAudioTrack) so it
// doesn't need to natively cover the whole window either.
const GENERATED_VISUAL_MAX_SECONDS = 45;

// How long to wait before the one allowed retry of the failure-path job
// re-fetch (see fetchLatestJobForCleanup) — short, since this already runs
// after the original failure and shouldn't meaningfully delay marking the
// job failed/refunding credit; long enough to ride out a brief DB/network
// blip rather than a sustained outage.
const CLEANUP_REFETCH_RETRY_DELAY_MS = 500;

interface SourceProbe {
  duration: number;
  hasAudioStream: boolean;
}

// ffprobe only reads container metadata (never transcodes/decodes the full
// file), so this normally completes in well under a second — 30s is
// generous headroom over any plausible legitimate case, bounding a hang on
// a crafted/malformed file instead of tying up a worker slot indefinitely.
const FFPROBE_TIMEOUT_MS = 30_000;

// One ffprobe call covering both duration (already needed everywhere) and
// audio-stream presence (needed before transcribeAudio/analyzeAudio, both of
// which require real audio and have no way to detect its absence
// themselves — they'd just hand a silent/video-only file to an external API
// and surface whatever cryptic error it returns).
//
// Spawns ffprobe directly (rather than fluent-ffmpeg's .ffprobe() wrapper)
// specifically because fluent-ffmpeg never exposes the child process it
// spawns internally — there'd be no way to kill it on timeout, which would
// leave the underlying process running in the background instead of
// actually bounding it. -print_format json produces the same
// {format, streams} shape fluent-ffmpeg already normalized to, so the
// duration/hasAudioStream extraction below is unchanged.
export function probeSource(filePath: string): Promise<SourceProbe> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-print_format", "json", "-show_format", "-show_streams", filePath]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms`));
    }, FFPROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
        resolve({
          duration: Number(data.format?.duration ?? 0),
          hasAudioStream: (data.streams ?? []).some((s) => s.codec_type === "audio"),
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse ffprobe output"));
      }
    });
  });
}

async function setStatus(
  supabase: SupabaseClient<Database>,
  jobId: string,
  status: Job["status"],
  extra: Partial<Job> = {},
) {
  const { error } = await supabase.from("jobs").update({ status, ...extra }).eq("id", jobId);
  if (error) throw new Error(`Failed to set job ${jobId} status to "${status}": ${error.message}`);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The only two shapes generated_visual_url/scene_visuals[].video_url are
// ever written as (see the rehostPath construction above, in
// runDiscoverPhase) — the main/group-0 visual and an additional scene-group
// visual, always scoped under this exact user and this exact job. Anchored
// full-string match (^...$), not a prefix check: a value that merely starts
// with this job's own prefix but has an unexpected suffix (e.g. a
// different extension, extra path segments, or a non-numeric/malformed
// group id) is rejected just like a value that belongs to a different
// user or job entirely.
export function isOwnGeneratedVisualPath(candidate: string, userId: string, jobId: string): boolean {
  const pattern = new RegExp(`^${escapeRegExp(userId)}/generated/${escapeRegExp(jobId)}(?:-group-\\d+)?\\.mp4$`);
  return pattern.test(candidate);
}

// generated_visual_url and scene_visuals[].video_url are written as bare
// uploads-bucket object paths — both write sites (jobRunner.ts, the
// `rehostPath` passed to the `generated_visual_url` update and into each
// SceneVisual's video_url) derive from the same plain
// `${user_id}/generated/${job.id}[-group-{n}].mp4` string, never a URL or
// a getPublicUrl() result (confirmed by re-reading both write sites before
// writing this). This is a defensive normalizer, not evidence a URL has
// ever actually been stored: it exists so a future regression (e.g. a
// getPublicUrl()-style write creeping into this path, as already happens
// for the separate `clips` bucket) fails safely — rejected and logged —
// rather than silently handing an unrelated string straight to
// storage.remove(). Every candidate, bare path or URL-extracted path
// alike, must pass isOwnGeneratedVisualPath — structural shape alone
// (e.g. "looks like a path", "is a same-origin uploads-bucket URL") is
// not sufficient on its own; it must be exactly this job's own object.
// Only ever extracts a path when the URL explicitly names the `uploads`
// bucket in Supabase Storage's own URL shape, confirmed against the
// installed @supabase/storage-js SDK source (getPublicUrl/createSignedUrl/
// download in node_modules/@supabase/storage-js): "public/" and "sign/"
// are real prefixes; a plain private authenticated download has no extra
// prefix segment at all (covered by the optional group matching nothing) —
// there is no real "/object/authenticated/<bucket>/..." shape, so that
// alternative has been removed rather than guessed at. Origin check (not
// just path shape) is what makes this "belonging to this project's
// uploads bucket" rather than "shaped like any Supabase Storage URL" —
// env.supabaseUrl is guaranteed set by assertEnv() at worker startup
// (index.ts) before any job is ever processed.
export function toUploadsObjectPath(value: string, userId: string, jobId: string): string | null {
  if (!value) return null;

  if (!value.includes("://")) {
    if (!isOwnGeneratedVisualPath(value, userId, jobId)) {
      console.error(`[job ${jobId}] rejected generated-visual path that isn't this job's own main/group video: ${value}`);
      return null;
    }
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`[job ${jobId}] rejected unparseable generated-visual URL: ${value}`);
    return null;
  }

  try {
    if (parsed.origin !== new URL(env.supabaseUrl).origin) {
      console.error(`[job ${jobId}] rejected generated-visual URL from an unexpected origin: ${value}`);
      return null;
    }
  } catch {
    console.error(`[job ${jobId}] could not verify generated-visual URL origin (env.supabaseUrl unset/invalid) — rejecting: ${value}`);
    return null;
  }

  const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?uploads\/([^?]+)/);
  if (!match) {
    console.error(`[job ${jobId}] rejected unrecognized generated-visual URL (not an uploads-bucket object): ${value}`);
    return null;
  }
  const extracted = decodeURIComponent(match[1]);
  if (!isOwnGeneratedVisualPath(extracted, userId, jobId)) {
    console.error(`[job ${jobId}] rejected generated-visual URL whose object path isn't this job's own main/group video: ${value}`);
    return null;
  }
  return extracted;
}

// Collects every generated-visual object path actually recorded on this
// job — generated_visual_url (the primary/group-0 visual) and every
// non-null scene_visuals[].video_url (additional scene-group visuals) —
// deduplicated, since group 0's path is written identically into both
// fields. Deliberately does not guess unrecorded group filenames: reads
// only what the database says was persisted, never what "should" exist
// given a group's position in the plan. generated_visual_url and each
// group's scene_visuals entry are now written to the database immediately
// after that group's own upload succeeds (see runDiscoverPhase), not
// batched until the end of the generation loop, so a path survives here as
// long as its own group finished uploading before the job failed. The one
// path this still cannot recover: a group whose Storage upload SUCCEEDED
// but whose own scene_visuals write (or, for group 0, its
// generated_visual_url write) then failed — the video exists in Storage,
// but nothing was ever committed to point at it, so there is nothing to
// read back for it here, by construction. (A group whose Storage upload
// itself fails creates no orphan at all — genUploadError is checked and
// throws before anything is written to either Storage or the database, so
// there is nothing left behind to clean up for that group.) This remaining
// gap is not solved by this function or its callers; it is a known,
// disclosed limitation. Callers must also pass the job row as it exists
// *after* the failure, not a pre-phase snapshot — see processJob's catch
// block, which re-fetches the row for exactly this reason.
export function collectGeneratedVisualPaths(upload: Upload, job: Job): string[] {
  const paths = new Set<string>();

  if (typeof job.generated_visual_url === "string" && job.generated_visual_url.length > 0) {
    const normalized = toUploadsObjectPath(job.generated_visual_url, upload.user_id, job.id);
    if (normalized) paths.add(normalized);
  }

  if (Array.isArray(job.scene_visuals)) {
    for (const entry of job.scene_visuals) {
      const videoUrl = entry && typeof entry === "object" ? (entry as SceneVisual).video_url : null;
      if (typeof videoUrl === "string" && videoUrl.length > 0) {
        const normalized = toUploadsObjectPath(videoUrl, upload.user_id, job.id);
        if (normalized) paths.add(normalized);
      }
    }
  }

  return [...paths];
}

// Removes every generated-visual Storage object recorded on this specific
// failed job (main visual + any additional scene-group visuals) — never
// upload.file_url (the user's original source) or any TTS-rehosted audio,
// neither of which this function ever reads. Scoped to generate-visual
// jobs only; a no-op for "has footage" jobs, which have nothing to clean
// up here. Never throws: a Storage error is logged, and any unexpected
// error (e.g. malformed scene_visuals data this function didn't already
// guard against) is caught and logged too, so a bug in this cleanup path
// can never prevent the caller's failed-status update or credit refund.
export async function removeGeneratedVisuals(
  supabase: SupabaseClient<Database>,
  upload: Upload,
  job: Job,
): Promise<void> {
  if (upload.visual_source !== "generate") return;

  try {
    const paths = collectGeneratedVisualPaths(upload, job);
    if (paths.length === 0) return;

    const { error } = await supabase.storage.from("uploads").remove(paths);
    if (error) {
      console.error(`[job ${job.id}] could not remove generated visual(s) (${paths.join(", ")}):`, error.message);
    }
  } catch (err) {
    console.error(`[job ${job.id}] unexpected error while removing generated visual(s):`, err instanceof Error ? err.message : err);
  }
}

// Re-fetches the job row for the failure-path cleanup in processJob's catch
// block below — scoped to exactly that one call site, not a general-purpose
// retry utility. At most one retry, after CLEANUP_REFETCH_RETRY_DELAY_MS,
// absorbs a brief DB/network blip (which, notably, isn't fully independent
// of whatever just failed the job itself) without meaningfully delaying the
// failed-status update/credit refund that follow. Handles both a returned
// Supabase error/no-row result and an actual thrown exception identically
// (each attempt has its own try/catch), since a thrown exception bypassing
// an inline `if (error || !data)` check — unlike one — would otherwise skip
// the retry entirely. Returns null (never the stale pre-phase job) if both
// attempts fail, so the caller decides what "no fresh data" means rather
// than this function silently substituting something it was never asked
// for.
export async function fetchLatestJobForCleanup(supabase: SupabaseClient<Database>, jobId: string): Promise<Job | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
      if (!error && data) return data;
      console.error(
        `[job ${jobId}] cleanup job re-fetch attempt ${attempt}/2 did not return the row: ${error?.message ?? "no row returned"}`,
      );
    } catch (err) {
      console.error(
        `[job ${jobId}] cleanup job re-fetch attempt ${attempt}/2 threw: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, CLEANUP_REFETCH_RETRY_DELAY_MS));
    }
  }
  return null;
}

export async function processJob(payload: PipelineJobPayload): Promise<void> {
  const jobId = payload.jobId;
  const supabase = createAdminClient();
  const workDir = await mkdtemp(path.join(tmpdir(), `velora-job-${jobId}-`));

  // Hoisted above the try block (rather than left as try-scoped consts) so
  // the catch block below can reach whichever of these were successfully
  // fetched before the failure, to know what to clean up.
  let job: Job | null = null;
  let upload: Upload | null = null;

  try {
    const { data: fetchedJob, error: jobError } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    job = fetchedJob;
    if (jobError || !job) {
      throw new Error(
        `Job ${jobId} not found: ${jobError?.message ?? "no row returned"} (code: ${jobError?.code ?? "n/a"})`,
      );
    }

    const { data: fetchedUpload, error: uploadError } = await supabase
      .from("uploads")
      .select("*")
      .eq("id", job.upload_id)
      .single();
    upload = fetchedUpload;
    if (uploadError || !upload) {
      throw new Error(
        `Upload for job ${jobId} not found: ${uploadError?.message ?? "no row returned"} (code: ${uploadError?.code ?? "n/a"})`,
      );
    }

    if (payload.phase === "discover") {
      await runDiscoverPhase(supabase, job, upload, workDir);
    } else if (payload.phase === "transform") {
      await runTransformPhase(supabase, job, upload, workDir);
    } else {
      // Deliberately does not throw on failure — see runReclipPhase's own
      // comment. A reclip failure must never hit the catch block below: no
      // credit was charged for a reclip (nothing to refund), and the
      // underlying job already succeeded (must not flip to "failed").
      await runReclipPhase(supabase, job, upload, workDir, payload.clipIds, payload.startSec, payload.endSec);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[job ${jobId}] failed:`, message);
    // Best-effort from here down — we're already in the failure path, so a
    // second failure just gets logged rather than thrown (nothing upstream
    // left to catch it, and throwing here would skip the workDir cleanup).
    // Wrapped in its own try/catch (on top of removeGeneratedVisuals' own
    // internal one) so a cleanup failure can never skip the failed-status
    // update or credit refund immediately below, no matter what.
    try {
      if (job && upload && (payload.phase === "discover" || payload.phase === "transform")) {
        // `job` was fetched before the phase ran and is never updated in
        // place — runDiscoverPhase's generated_visual_url/scene_visuals
        // writes go straight to the database, not back into this object —
        // so using it directly here would make removeGeneratedVisuals look
        // for paths that were never there to begin with, missing exactly
        // the visuals a failure after a successful generation actually
        // left in Storage. Re-fetch the row (with one bounded retry — see
        // fetchLatestJobForCleanup) so cleanup sees whatever was actually
        // persisted before the failure.
        const latestJob = await fetchLatestJobForCleanup(supabase, jobId);
        if (!latestJob) {
          // Both attempts failed. Falling back to `job` is the safest
          // remaining option — it can only miss paths persisted after it
          // was taken, never invent ones that don't belong to this job,
          // since isOwnGeneratedVisualPath's ownership check is unaffected
          // either way — but it is NOT a guarantee anything will be found:
          // `job` is whatever existed before this phase ran, most often
          // nothing at all. Tagged distinctly so this degraded path (DB
          // unreachable right when cleanup needed it most) can be
          // alerted on or reconciled against Storage directly, rather than
          // reading as an ordinary "nothing to clean up" no-op.
          console.error(
            `[job ${jobId}] [orphan-risk] could not refresh job after 2 attempts before generated-visual cleanup — attempting cleanup with only the pre-phase snapshot already in hand, which may be incomplete or empty.`,
          );
        }
        await removeGeneratedVisuals(supabase, upload, latestJob ?? job);
      }
    } catch (cleanupErr) {
      console.error(`[job ${jobId}] generated-visual cleanup threw unexpectedly:`, cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
    const { error: failStatusError } = await supabase
      .from("jobs")
      .update({ status: "failed", error_message: message.slice(0, 2000) })
      .eq("id", jobId);
    if (failStatusError) console.error(`[job ${jobId}] could not mark job as failed:`, failStatusError.message);
    // The initial credit reservation from create_job() is refunded so a
    // pipeline failure never silently burns the user's credit. Safe to call
    // even mid-transform — it only ever refunds the single initial
    // reservation, and claim_clip_credit's own top-ups for additional
    // confirmed segments are a pre-existing, accepted gap this phase split
    // doesn't change (same as the original single-phase pipeline).
    const { error: refundError } = await supabase.rpc("refund_job_reservation", { p_job_id: jobId });
    if (refundError) console.error(`[job ${jobId}] could not refund credit reservation:`, refundError.message);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Steps 1-3 of the original single-phase pipeline: get source audio,
 * analyze it, optionally generate visuals, select candidate moments. Ends
 * at awaiting_selection instead of rendering — Discover is what the user
 * sees next, and rendering only resumes once they confirm which moments to
 * keep (runTransformPhase, triggered by POST /api/jobs/[id]/confirm-selection).
 */
async function runDiscoverPhase(
  supabase: SupabaseClient<Database>,
  job: Job,
  upload: Upload,
  workDir: string,
): Promise<void> {
  let sourceBytes: Buffer;
  let sourceExt: string;
  // Populated below only for tts + generate jobs (the only path that plans
  // scenes at all — see the scene_plan write further down). Kept in memory
  // rather than re-read from Supabase since this same function already
  // holds it right after writing it; null/empty is the expected, unchanged
  // state for every other job shape (has-footage, uploaded audio, or
  // visual_source !== "generate").
  let scenePlan: Scene[] | null = null;

  if (upload.audio_source === "tts") {
    await setStatus(supabase, job.id, "generating_voiceover");
    if (!upload.script_text || !upload.tts_voice_id) {
      throw new Error("TTS upload is missing script_text or tts_voice_id");
    }

    // Script-driven scene plan for the generate-video path (see
    // scenePlanner.ts) — planned from the same script_text right after it's
    // confirmed non-null, before any audio work starts. Not yet consumed by
    // anything downstream; a planning failure is left to the existing
    // top-level catch in runJob, same as any other discover-phase failure.
    //
    // Gated on visual_source === "generate" too, not just audio_source ===
    // "tts": a scene plan only makes sense for the generate-video path (it
    // drives what gets generated), and this is defense-in-depth against any
    // legacy row with the old invalid tts + has combination — API
    // validation already prevents this for new uploads.
    if (upload.visual_source === "generate") {
      scenePlan = await planScenes(upload.script_text);
      const { error: scenePlanError } = await supabase.from("jobs").update({ scene_plan: scenePlan }).eq("id", job.id);
      if (scenePlanError) throw new Error(`Failed to save scene plan: ${scenePlanError.message}`);
    }

    sourceBytes = await generateVoiceover(upload.script_text, upload.tts_voice_id);
    sourceExt = ".mp3";

    // Re-host in our own storage (same reasoning as the generated-visual
    // path) so there's a durable record independent of ElevenLabs' own
    // retention, and so file_url is populated for the transform phase (and
    // anything else downstream) to read back later without regenerating.
    const rehostPath = `${upload.user_id}/tts/${job.id}.mp3`;
    const { error: ttsUploadError } = await supabase.storage
      .from("uploads")
      .upload(rehostPath, sourceBytes, { contentType: "audio/mpeg", upsert: true });
    if (ttsUploadError) throw new Error(`Failed to re-host TTS voiceover: ${ttsUploadError.message}`);
    const { error: ttsUpdateError } = await supabase.from("uploads").update({ file_url: rehostPath }).eq("id", upload.id);
    if (ttsUpdateError) throw new Error(`Failed to save TTS voiceover file_url: ${ttsUpdateError.message}`);
  } else {
    if (!upload.file_url) throw new Error("Upload is missing file_url");
    const { data: fileBlob, error: downloadError } = await supabase.storage.from("uploads").download(upload.file_url);
    if (downloadError || !fileBlob) throw new Error("Could not download uploaded file from storage");
    sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
    sourceExt = path.extname(upload.file_name) || "";
  }

  const sourcePath = path.join(workDir, `source${sourceExt}`);
  await writeFile(sourcePath, sourceBytes);
  const { duration: sourceDuration, hasAudioStream } = await probeSource(sourcePath);

  // Applies to both branches below (transcribeAudio and analyzeAudio both
  // require real audio) and runs before either — a video with no audio
  // track should fail here with a clear reason, not minutes later as a
  // cryptic error surfaced verbatim from AssemblyAI or librosa. TTS-sourced
  // audio always has a stream (ElevenLabs output), so this never fires on
  // that path — no need to special-case audio_source separately.
  if (!hasAudioStream) {
    throw new Error("This video doesn't contain an audio track. Please upload a video with audio.");
  }

  await setStatus(supabase, job.id, "analyzing");
  let transcript: Job["transcript"] = null;
  let audioAnalysis: Job["audio_analysis"] = null;

  if (upload.content_type === "spoken") {
    transcript = await transcribeAudio(sourceBytes);
    const { error: transcriptError } = await supabase.from("jobs").update({ transcript }).eq("id", job.id);
    if (transcriptError) throw new Error(`Failed to save transcript: ${transcriptError.message}`);
  } else {
    audioAnalysis = await analyzeAudio(sourceBytes, upload.beat_sync_enabled);
    const { error: analysisError } = await supabase.from("jobs").update({ audio_analysis: audioAnalysis }).eq("id", job.id);
    if (analysisError) throw new Error(`Failed to save audio analysis: ${analysisError.message}`);
  }

  let visualIsGenerated = false;
  let generatedWindowSeconds = sourceDuration;
  // Whatever moment thumbnails get extracted from below — the original
  // upload for the "has footage" path, or the generated visual once it
  // exists. Only meaningful when the source actually has a video stream;
  // an audio-only upload has no frames to grab (same constraint the
  // original single-phase pipeline already had at render time).
  let thumbnailSourcePath = sourcePath;

  if (upload.visual_source === "generate") {
    await setStatus(supabase, job.id, "generating_visuals");
    generatedWindowSeconds = Math.min(sourceDuration, GENERATED_VISUAL_MAX_SECONDS);

    const hasScenePlan = !!(scenePlan && scenePlan.length > 0);

    // Step 4J: group the scene plan into at most MAX_VISUAL_GENERATIONS_PER_JOB
    // Higgsfield visual generations (see sceneGrouping.ts and the Step
    // 4G-4I design audits) instead of the earlier single-generic-call
    // behavior. Jobs with no scene plan (every shape besides tts + generate)
    // fall back to a single synthetic group with no representative scene —
    // exactly the old generic-prompt call, unchanged.
    const groups: SceneGenerationGroup[] = hasScenePlan
      ? groupScenesForGeneration(scenePlan!, MAX_VISUAL_GENERATIONS_PER_JOB)
      : [{ group_id: 0, scene_indices: [], scenes: [] }];

    // Defensive: groupScenesForGeneration() already enforces this ceiling
    // itself, but this loop is what actually spends money on Higgsfield
    // requests, so it never trusts that invariant blindly — a future bug in
    // the grouping function can never turn into an extra paid request.
    if (groups.length > MAX_VISUAL_GENERATIONS_PER_JOB) {
      throw new Error(
        `Scene visual generation budget exceeded: ${groups.length} > ${MAX_VISUAL_GENERATIONS_PER_JOB}`,
      );
    }

    // Positionally aligned with scenePlan — every scene starts "pending"
    // and is filled in as its group's generation completes. Null (not this
    // array) for jobs with no scene plan; nothing to record per-scene.
    const sceneVisuals: SceneVisual[] | null = hasScenePlan
      ? scenePlan!.map(() => ({ group_id: -1, status: "pending", video_url: null, generated_duration_seconds: null, error_message: null }))
      : null;
    if (sceneVisuals) {
      for (const group of groups) {
        for (const sceneIndex of group.scene_indices) sceneVisuals[sceneIndex].group_id = group.group_id;
      }
    }

    // Sequential by design (Step 4J scope) — no added concurrency, no
    // retries, so a mid-loop failure's blast radius (Higgsfield spend,
    // failure handling) stays exactly as simple as the original
    // single-call path: any throw here propagates to runJob's existing
    // top-level catch, which marks the job failed and refunds the credit
    // reservation, same as before.
    for (const group of groups) {
      // Full ordered group, not just its first scene — generateVisual()
      // folds every scene's description/action into the prompt now (see
      // buildSceneImagePrompt/buildSceneMotionPrompt), still exactly one
      // image + one video Higgsfield generation for the whole group.
      const groupScenes = hasScenePlan ? group.scenes : undefined;

      const { videoUrl } = await generateVisual({
        contentType: upload.content_type,
        moodDescription: upload.mood_description,
        style: upload.visual_style,
        durationSeconds: generatedWindowSeconds,
        scenes: groupScenes,
      });

      const genRes = await fetch(videoUrl);
      // TEMPORARY DIAGNOSTIC — remove once the production "generated video has
      // no video stream" investigation is resolved. Logs only response
      // metadata and a 16-byte hex prefix (to sanity-check the ISO-BMFF/MP4
      // "ftyp" signature) — never videoUrl, headers beyond content-type/
      // content-length, or any other response content.
      console.log(
        `[discover] generated visual fetch (group ${group.group_id}): status=${genRes.status} content-type=${genRes.headers.get("content-type")} content-length=${genRes.headers.get("content-length")}`,
      );
      if (!genRes.ok) throw new Error(`Could not download generated visual for group ${group.group_id} (${genRes.status})`);
      const genBytes = Buffer.from(await genRes.arrayBuffer());
      const looksLikeIsoBmff = genBytes.subarray(4, 8).toString("ascii") === "ftyp";
      console.log(
        `[discover] generated visual downloaded (group ${group.group_id}): bytes=${genBytes.length} first16Hex=${genBytes.subarray(0, 16).toString("hex")} looksLikeIsoBmff=${looksLikeIsoBmff}`,
      );

      // Group 0 always covers scene 0 (grouping always starts from scene 0)
      // — or is the sole synthetic group when there's no scene plan — so
      // it's exactly the single asset every existing downstream consumer
      // (selectSegments' window, discover thumbnails, runTransformPhase,
      // runReclipPhase) already expects. Reusing the identical path/field
      // for it means none of that code needs to change yet, per this
      // step's scope. Any additional group (only possible once a scene
      // plan produces >1 group) gets its own, disambiguated path so it
      // doesn't overwrite group 0's file — flagged explicitly in the Step
      // 4J report, since those extra assets aren't consumed by anything
      // downstream yet (that's the later assembly step).
      const isPrimaryGroup = group.group_id === 0;
      const groupGenPath = path.join(workDir, isPrimaryGroup ? "generated.mp4" : `generated-group-${group.group_id}.mp4`);
      await writeFile(groupGenPath, genBytes);

      const rehostPath = isPrimaryGroup
        ? `${upload.user_id}/generated/${job.id}.mp4`
        : `${upload.user_id}/generated/${job.id}-group-${group.group_id}.mp4`;
      const { error: genUploadError } = await supabase.storage
        .from("uploads")
        .upload(rehostPath, genBytes, { contentType: "video/mp4", upsert: true });
      if (genUploadError) throw new Error(`Failed to re-host generated visual for group ${group.group_id}: ${genUploadError.message}`);

      if (sceneVisuals) {
        const { duration: groupDuration } = await probeSource(groupGenPath);
        for (const sceneIndex of group.scene_indices) {
          sceneVisuals[sceneIndex] = {
            group_id: group.group_id,
            status: "completed",
            video_url: rehostPath,
            generated_duration_seconds: groupDuration,
            error_message: null,
          };
        }

        // Persisted once per completed group, not batched until after the
        // whole loop — the same immediacy generated_visual_url already has
        // below. A later group's generation/upload can still throw and
        // abort the loop; writing here means THIS group's video_url is
        // already durable before that happens, so the failure-path cleanup
        // (removeGeneratedVisuals, via its now-freshly-refetched job row)
        // can actually find and remove it instead of only ever learning
        // about it from a final write that a later failure prevented from
        // ever running.
        const { error: sceneVisualsError } = await supabase.from("jobs").update({ scene_visuals: sceneVisuals }).eq("id", job.id);
        if (sceneVisualsError) throw new Error(`Failed to save scene visuals: ${sceneVisualsError.message}`);
      }

      if (isPrimaryGroup) {
        visualIsGenerated = true;
        thumbnailSourcePath = groupGenPath;
        const { error: genUrlError } = await supabase.from("jobs").update({ generated_visual_url: rehostPath }).eq("id", job.id);
        if (genUrlError) throw new Error(`Failed to save generated_visual_url: ${genUrlError.message}`);
      }
    }
  }

  await setStatus(supabase, job.id, "selecting");

  const selectionWindow = visualIsGenerated ? generatedWindowSeconds : sourceDuration;
  const scopedTranscript =
    transcript && visualIsGenerated
      ? { full_text: transcript.full_text, words: transcript.words.filter((w) => w.end / 1000 <= selectionWindow) }
      : transcript;
  const scopedAnalysis =
    audioAnalysis && visualIsGenerated
      ? { ...audioAnalysis, windows: audioAnalysis.windows.filter((w) => w.end <= selectionWindow) }
      : audioAnalysis;

  let segments: SelectedSegment[];
  if (selectionWindow < MIN_CLIP_SECONDS) {
    // Too short to search for a hook moment within — there's no room for a
    // sub-clip that meets the minimum length, so just use the whole thing.
    segments = [
      {
        start_time: 0,
        end_time: selectionWindow,
        hook_type: upload.content_type === "music" ? "chorus" : "emotional",
        suggested_caption: "the whole moment",
        confidence: 100,
      },
    ];
  } else {
    segments = await selectSegments(upload.content_type, scopedTranscript, scopedAnalysis, selectionWindow);
    const preFilterCount = segments.length;
    segments = segments.filter((s) => s.end_time <= selectionWindow + 0.5);
    if (segments.length === 0) {
      console.log(
        `[job ${job.id}] zero segments: contentType=${upload.content_type} sourceDuration=${sourceDuration} selectionWindow=${selectionWindow} preFilterCount=${preFilterCount} transcriptWords=${scopedTranscript?.words.length ?? "n/a"} analysisWindows=${scopedAnalysis?.windows.length ?? "n/a"}`,
      );
    }
  }

  if (segments.length === 0) {
    throw new Error("No hook-worthy segments were found in this upload");
  }

  // Real preview frames for Discover — one per candidate moment, grabbed
  // straight from the source at that moment's own start time. Best-effort:
  // an audio-only upload has no video stream to screenshot, so a failure
  // here just leaves that moment without a thumbnail (the UI falls back to
  // a plain placeholder) rather than failing the whole job.
  const segmentsWithThumbnails: SelectedSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    try {
      const thumbPath = path.join(workDir, `discover-${i}-thumb.jpg`);
      await extractThumbnailAt(thumbnailSourcePath, thumbPath, segment.start_time + 1);
      const thumbnailUrl = await uploadClipAsset(
        supabase, upload.user_id, job.id, thumbPath, `discover-${i}-thumb.jpg`, "image/jpeg",
      );
      segmentsWithThumbnails.push({ ...segment, thumbnail_url: thumbnailUrl });
    } catch (err) {
      console.error(`[job ${job.id}] discover thumbnail ${i} failed:`, err instanceof Error ? err.message : err);
      segmentsWithThumbnails.push(segment);
    }
  }

  // Real per-segment "why this was surfaced" text, grounded in each
  // segment's own transcript excerpt/hook_type — best-effort, same as the
  // thumbnail loop above: a failure here just leaves `why` unset on the
  // affected segment(s) (the UI falls back to the static hook_type-based
  // template) rather than failing the whole job.
  let explanations: Map<number, string>;
  try {
    explanations = await explainSegments(upload.content_type, segmentsWithThumbnails, transcript);
  } catch (err) {
    console.error(`[job ${job.id}] discover explanations failed:`, err instanceof Error ? err.message : err);
    explanations = new Map();
  }
  const segmentsWithExplanations = segmentsWithThumbnails.map((segment, i) => {
    const why = explanations.get(i);
    return why ? { ...segment, why } : segment;
  });

  // Discover is what the user sees next — no rendering happens until they
  // confirm (see confirm-selection route + runTransformPhase).
  await setStatus(supabase, job.id, "awaiting_selection", { selected_segments: segmentsWithExplanations });
}

/**
 * Step 4-5 of the original pipeline, unchanged in substance: cut, caption,
 * and reformat per platform — now scoped to only the segments the user
 * confirmed on Discover instead of every segment the LLM proposed. Runs as
 * a fresh worker invocation (possibly a different machine), so it
 * re-derives the source/visual files from storage rather than assuming
 * runDiscoverPhase's workDir is still around — consistent with this
 * worker's existing "no state outside Supabase" design.
 */
async function runTransformPhase(
  supabase: SupabaseClient<Database>,
  job: Job,
  upload: Upload,
  workDir: string,
): Promise<void> {
  const allSegments = job.selected_segments ?? [];
  const confirmedIndices = job.confirmed_segment_indices ?? [];
  const confirmedSegments = confirmedIndices
    .map((i) => allSegments[i])
    .filter((s): s is SelectedSegment => !!s);

  if (confirmedSegments.length === 0) {
    throw new Error("No confirmed segments to render");
  }

  // Re-derive the audio/video source. By this point upload.file_url is
  // always populated — either the original upload, or the TTS voiceover
  // runDiscoverPhase already generated and rehosted — so there's no
  // TTS-specific branch here the way there is in the discover phase.
  if (!upload.file_url) throw new Error("Upload is missing file_url");
  const { data: fileBlob, error: downloadError } = await supabase.storage.from("uploads").download(upload.file_url);
  if (downloadError || !fileBlob) throw new Error("Could not download source file from storage");
  const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
  const sourceExt = path.extname(upload.file_name) || "";
  const sourcePath = path.join(workDir, `source${sourceExt}`);
  await writeFile(sourcePath, sourceBytes);

  const visualIsGenerated = upload.visual_source === "generate";
  let visualSourcePath = sourcePath;

  if (visualIsGenerated) {
    if (!job.generated_visual_url) throw new Error("Job is missing generated_visual_url");
    const { data: genBlob, error: genError } = await supabase.storage.from("uploads").download(job.generated_visual_url);
    if (genError || !genBlob) throw new Error("Could not download generated visual from storage");
    const genPath = path.join(workDir, "generated.mp4");
    await writeFile(genPath, Buffer.from(await genBlob.arrayBuffer()));
    visualSourcePath = genPath;
  }

  const transcript = job.transcript;
  const audioAnalysis = job.audio_analysis;

  // Credit truthing, same as the original single-phase pipeline: the first
  // confirmed segment rides create_job()'s initial reservation, every
  // additional one must successfully claim its own credit or gets dropped.
  // Everything from here through the final clips insert is wrapped in a
  // try/catch keyed on `extraCreditsClaimed`: if a render, upload, or the
  // insert itself fails *after* one or more top-up credits were granted,
  // processJob's outer catch only ever refunds the single initial
  // create_job() reservation (see refund_job_reservation), so without this
  // the top-ups would be silently burned with no clips to show for them.
  const affordableSegments: SelectedSegment[] = [confirmedSegments[0]];
  let extraCreditsClaimed = 0;

  try {
    for (let i = 1; i < confirmedSegments.length; i++) {
      const { data: claimed, error: claimError } = await supabase.rpc("claim_clip_credit", {
        p_user_id: job.user_id,
        p_generated: visualIsGenerated,
      });
      // An RPC/database error is not the same thing as "out of credits" —
      // claimed would come back falsy either way, so this must be checked
      // explicitly rather than folded into the `!claimed` exhaustion check
      // below, or a transient DB error would silently look like the user
      // ran out of credits and drop every remaining segment.
      if (claimError) {
        throw new Error(`Failed to claim clip credit: ${claimError.message}`);
      }
      if (!claimed) break; // genuine exhaustion — stop adding segments, not a failure
      extraCreditsClaimed++;
      affordableSegments.push(confirmedSegments[i]);
    }

    await setStatus(supabase, job.id, "cutting");

    const beatGrid = upload.beat_sync_enabled ? audioAnalysis?.beat_grid : undefined;
    const clipRows: Database["public"]["Tables"]["clips"]["Insert"][] = [];

    for (let i = 0; i < affordableSegments.length; i++) {
      const segment = affordableSegments[i];
      const { start, end } = upload.beat_sync_enabled
        ? snapToBeats(segment.start_time, segment.end_time, beatGrid)
        : { start: segment.start_time, end: segment.end_time };

      const cues =
        upload.content_type === "spoken" && transcript
          ? buildWordCues(transcript.words, start, end)
          : buildMusicCue(segment.suggested_caption, start, end, beatGrid, upload.beat_sync_enabled);
      const captionStyle = upload.content_type === "spoken" ? "Word" : "Caption";
      const assPath = path.join(workDir, `segment-${i}.ass`);
      await writeAssFile(assPath, buildAssDocument(cues, captionStyle, upload.brand_color));

      const targets = [
        { target: VERTICAL_TARGET, outPath: path.join(workDir, `segment-${i}-vertical.mp4`) },
        { target: PINTEREST_TARGET, outPath: path.join(workDir, `segment-${i}-pinterest.mp4`) },
      ];

      for (const { target, outPath } of targets) {
        if (visualIsGenerated) {
          await renderClipWithAudioTrack({
            inputPath: visualSourcePath,
            audioPath: sourcePath,
            outputPath: outPath,
            startSec: start,
            endSec: end,
            assPath,
            target,
          });
        } else {
          await renderClip({
            inputPath: visualSourcePath,
            outputPath: outPath,
            startSec: start,
            endSec: end,
            assPath,
            target,
          });
        }
      }

      if (i === affordableSegments.length - 1) {
        await setStatus(supabase, job.id, "captioning");
      }

      const thumbPath = path.join(workDir, `segment-${i}-thumb.jpg`);
      await extractThumbnail(targets[0].outPath, thumbPath);

      const verticalUrl = await uploadClipAsset(
        supabase, upload.user_id, job.id, targets[0].outPath, `segment-${i}-vertical.mp4`, "video/mp4",
      );
      const pinterestUrl = await uploadClipAsset(
        supabase, upload.user_id, job.id, targets[1].outPath, `segment-${i}-pinterest.mp4`, "video/mp4",
      );
      const thumbUrl = await uploadClipAsset(
        supabase, upload.user_id, job.id, thumbPath, `segment-${i}-thumb.jpg`, "image/jpeg",
      );

      const durationSeconds = Math.round(end - start);
      const title = segment.suggested_caption;

      for (const platform of PLATFORMS_FOR_VERTICAL) {
        clipRows.push({
          job_id: job.id,
          user_id: job.user_id,
          title,
          hook_type: segment.hook_type,
          start_time: start.toFixed(1),
          end_time: end.toFixed(1),
          duration_seconds: durationSeconds,
          confidence: segment.confidence,
          platform,
          file_url: verticalUrl,
          thumbnail_url: thumbUrl,
        });
      }
      clipRows.push({
        job_id: job.id,
        user_id: job.user_id,
        title,
        hook_type: segment.hook_type,
        start_time: start.toFixed(1),
        end_time: end.toFixed(1),
        duration_seconds: durationSeconds,
        confidence: segment.confidence,
        platform: "pinterest",
        file_url: pinterestUrl,
        thumbnail_url: thumbUrl,
      });
    }

    const { error: clipsError } = await supabase.from("clips").insert(clipRows);
    if (clipsError) throw new Error(`Failed to save clips: ${clipsError.message}`);

    await setStatus(supabase, job.id, "done");
  } catch (err) {
    // Refund every top-up credit granted above, beyond the initial
    // create_job() reservation — processJob's outer catch (below) still
    // handles that single initial reservation via the same
    // refund_job_reservation RPC, which is a plain +1/-1 adjustment on the
    // profile row (not tied to a specific reservation record), so calling it
    // once per top-up here is the correct mirror of each claim_clip_credit
    // call above and composes cleanly with the outer catch's own call.
    for (let i = 0; i < extraCreditsClaimed; i++) {
      const { error: refundError } = await supabase.rpc("refund_job_reservation", { p_job_id: job.id });
      if (refundError) {
        console.error(
          `[job ${job.id}] could not refund top-up credit ${i + 1}/${extraCreditsClaimed}:`,
          refundError.message,
        );
      }
    }
    throw err;
  }
}

/**
 * Re-renders one already-approved moment's clip rows at new start/end
 * bounds (POST /api/clips/[id]/re-render enqueues this after setting
 * render_started_at on the affected rows). Unlike the other two phases,
 * this one never throws — a reclip failure is handled entirely inside this
 * function, because processJob's outer catch below marks the job "failed"
 * and refunds the initial credit reservation, and neither is correct here:
 * the job is already `done`, and re-rendering an already-paid-for moment
 * doesn't charge another credit, so there's nothing to refund. The only
 * thing that must happen on either path is clearing render_started_at so
 * Review stops showing these rows as mid-render. The original clip rows
 * and storage objects are left completely untouched until the new render
 * and all three uploads have fully succeeded.
 */
async function runReclipPhase(
  supabase: SupabaseClient<Database>,
  job: Job,
  upload: Upload,
  workDir: string,
  clipIds: string[],
  startSec: number,
  endSec: number,
): Promise<void> {
  try {
    const { data: existingClips, error: clipsFetchError } = await supabase
      .from("clips")
      .select("*")
      .in("id", clipIds)
      .eq("job_id", job.id);
    if (clipsFetchError) throw new Error(`Failed to load clips for reclip: ${clipsFetchError.message}`);
    if (!existingClips || existingClips.length === 0) throw new Error("No matching clip rows found for reclip");

    const verticalClipIds = existingClips.filter((c) => c.platform !== "pinterest").map((c) => c.id);
    const pinterestClipIds = existingClips.filter((c) => c.platform === "pinterest").map((c) => c.id);
    const title = existingClips[0].title ?? "";

    // Re-derive the source/visual files exactly as runTransformPhase does —
    // this phase can run on a different worker instance than the one that
    // originally rendered the clip, so nothing about that render is assumed
    // to still be on disk anywhere.
    if (!upload.file_url) throw new Error("Upload is missing file_url");
    const { data: fileBlob, error: downloadError } = await supabase.storage.from("uploads").download(upload.file_url);
    if (downloadError || !fileBlob) throw new Error("Could not download source file from storage");
    const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
    const sourceExt = path.extname(upload.file_name) || "";
    const sourcePath = path.join(workDir, `source${sourceExt}`);
    await writeFile(sourcePath, sourceBytes);

    const visualIsGenerated = upload.visual_source === "generate";
    let visualSourcePath = sourcePath;

    if (visualIsGenerated) {
      if (!job.generated_visual_url) throw new Error("Job is missing generated_visual_url");
      const { data: genBlob, error: genError } = await supabase.storage.from("uploads").download(job.generated_visual_url);
      if (genError || !genBlob) throw new Error("Could not download generated visual from storage");
      const genPath = path.join(workDir, "generated.mp4");
      await writeFile(genPath, Buffer.from(await genBlob.arrayBuffer()));
      visualSourcePath = genPath;
    }

    const transcript = job.transcript;
    const audioAnalysis = job.audio_analysis;
    const beatGrid = upload.beat_sync_enabled ? audioAnalysis?.beat_grid : undefined;
    const { start, end } = upload.beat_sync_enabled
      ? snapToBeats(startSec, endSec, beatGrid)
      : { start: startSec, end: endSec };

    const cues =
      upload.content_type === "spoken" && transcript
        ? buildWordCues(transcript.words, start, end)
        : buildMusicCue(title, start, end, beatGrid, upload.beat_sync_enabled);
    const captionStyle = upload.content_type === "spoken" ? "Word" : "Caption";
    const assPath = path.join(workDir, "reclip.ass");
    await writeAssFile(assPath, buildAssDocument(cues, captionStyle, upload.brand_color));

    // Distinct filenames so the new render never collides with (or
    // upserts over) the original clip's still-live storage objects — the
    // swap only happens below, once everything has succeeded.
    const suffix = randomUUID();
    const targets = [
      { target: VERTICAL_TARGET, outPath: path.join(workDir, `reclip-${suffix}-vertical.mp4`) },
      { target: PINTEREST_TARGET, outPath: path.join(workDir, `reclip-${suffix}-pinterest.mp4`) },
    ];

    for (const { target, outPath } of targets) {
      if (visualIsGenerated) {
        await renderClipWithAudioTrack({
          inputPath: visualSourcePath,
          audioPath: sourcePath,
          outputPath: outPath,
          startSec: start,
          endSec: end,
          assPath,
          target,
        });
      } else {
        await renderClip({
          inputPath: visualSourcePath,
          outputPath: outPath,
          startSec: start,
          endSec: end,
          assPath,
          target,
        });
      }
    }

    const thumbPath = path.join(workDir, `reclip-${suffix}-thumb.jpg`);
    await extractThumbnail(targets[0].outPath, thumbPath);

    const verticalUrl = await uploadClipAsset(
      supabase, upload.user_id, job.id, targets[0].outPath, `reclip-${suffix}-vertical.mp4`, "video/mp4",
    );
    const pinterestUrl = await uploadClipAsset(
      supabase, upload.user_id, job.id, targets[1].outPath, `reclip-${suffix}-pinterest.mp4`, "video/mp4",
    );
    const thumbUrl = await uploadClipAsset(
      supabase, upload.user_id, job.id, thumbPath, `reclip-${suffix}-thumb.jpg`, "image/jpeg",
    );

    const durationSeconds = Math.round(end - start);
    const startTime = start.toFixed(1);
    const endTime = end.toFixed(1);

    // Both renders and all three uploads succeeded — safe to swap the
    // database pointers now. This is the only point at which the original
    // clip rows are modified. A moment can span two groups with different
    // file_url values (vertical vs pinterest), so this goes through the
    // apply_reclip DB function rather than two separate .update() calls —
    // one function call is one implicit transaction, so the two groups
    // commit together or not at all; there's no window where vertical rows
    // show the new render while pinterest is still on the old one.
    const { error: applyError } = await supabase.rpc("apply_reclip", {
      p_vertical_clip_ids: verticalClipIds,
      p_pinterest_clip_ids: pinterestClipIds,
      p_vertical_file_url: verticalUrl,
      p_pinterest_file_url: pinterestUrl,
      p_thumbnail_url: thumbUrl,
      p_start_time: startTime,
      p_end_time: endTime,
      p_duration_seconds: durationSeconds,
    });
    if (applyError) throw new Error(`Failed to apply reclip: ${applyError.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[job ${job.id}] reclip failed:`, message);
    // Isolated in its own try/catch, deliberately: this cleanup must never
    // let an exception escape runReclipPhase. If it did, processJob's outer
    // catch would treat it as a pipeline failure and mark the already-done
    // job "failed" plus attempt a refund for credit that was never charged
    // — exactly what this phase exists to avoid. A cleanup failure is
    // logged alongside, not instead of, the original reclip failure above.
    try {
      // render_failed_at is the explicit signal Review reads to show a
      // failure state — set alongside clearing render_started_at so the two
      // never disagree (never "still rendering" and "failed" at once, and
      // never "failed" while a render_started_at claim is stuck non-null).
      const { error: clearError } = await supabase
        .from("clips")
        .update({ render_started_at: null, render_failed_at: new Date().toISOString() })
        .in("id", clipIds);
      if (clearError) {
        console.error(`[job ${job.id}] could not clear render_started_at after reclip failure:`, clearError.message);
      }
    } catch (clearErr) {
      const clearMessage = clearErr instanceof Error ? clearErr.message : "Unknown error";
      console.error(`[job ${job.id}] render_started_at cleanup threw after reclip failure:`, clearMessage);
    }
  }
}
