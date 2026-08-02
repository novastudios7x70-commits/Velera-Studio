import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./lib/supabase.js";
import { transcribeAudio } from "./pipeline/transcribe.js";
import { analyzeAudio } from "./pipeline/audioAnalysis.js";
import { generateVisual } from "./pipeline/generateVisuals.js";
import { selectSegments } from "./pipeline/selectSegments.js";
import { buildAssDocument, buildMusicCue, buildWordCues } from "./pipeline/captions.js";
import {
  PINTEREST_TARGET,
  VERTICAL_TARGET,
  extractThumbnail,
  renderClip,
  renderClipWithAudioTrack,
  snapToBeats,
  writeAssFile,
} from "./pipeline/ffmpegRender.js";
import { uploadClipAsset } from "./pipeline/uploadOutputs.js";
import type { Database, Job, SelectedSegment, Upload } from "./lib/database.types.js";

const PLATFORMS_FOR_VERTICAL = ["tiktok", "shorts", "reels", "facebook"] as const;
// Must stay >= selectSegments.ts's MIN_CLIP_SECONDS (12) with real slack —
// too tight a window leaves the segment selector almost no room to find a
// segment that's both long enough and fully inside the window, and this
// project's confirmed the empty-result failure mode firsthand. The
// generated visual clip itself loops (see renderClipWithAudioTrack) so it
// doesn't need to natively cover the whole window either.
const GENERATED_VISUAL_MAX_SECONDS = 45;

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 0);
    });
  });
}

async function setStatus(
  supabase: SupabaseClient<Database>,
  jobId: string,
  status: Job["status"],
  extra: Partial<Job> = {},
) {
  await supabase.from("jobs").update({ status, ...extra }).eq("id", jobId);
}

export async function processJob(jobId: string): Promise<void> {
  const supabase = createAdminClient();
  const workDir = await mkdtemp(path.join(tmpdir(), `velora-job-${jobId}-`));

  try {
    const { data: job, error: jobError } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (jobError || !job) {
      throw new Error(
        `Job ${jobId} not found: ${jobError?.message ?? "no row returned"} (code: ${jobError?.code ?? "n/a"})`,
      );
    }

    const { data: upload, error: uploadError } = await supabase
      .from("uploads")
      .select("*")
      .eq("id", job.upload_id)
      .single();
    if (uploadError || !upload) {
      throw new Error(
        `Upload for job ${jobId} not found: ${uploadError?.message ?? "no row returned"} (code: ${uploadError?.code ?? "n/a"})`,
      );
    }

    await runPipeline(supabase, job, upload, workDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[job ${jobId}] failed:`, message);
    await supabase.from("jobs").update({ status: "failed", error_message: message.slice(0, 2000) }).eq("id", jobId);
    // The initial credit reservation from create_job() is refunded so a
    // pipeline failure never silently burns the user's credit.
    await supabase.rpc("refund_job_reservation", { p_job_id: jobId });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runPipeline(
  supabase: SupabaseClient<Database>,
  job: Job,
  upload: Upload,
  workDir: string,
): Promise<void> {
  // --- Step 1 (already done at upload time) — download the source file ---
  const { data: fileBlob, error: downloadError } = await supabase.storage.from("uploads").download(upload.file_url);
  if (downloadError || !fileBlob) throw new Error("Could not download uploaded file from storage");
  const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
  const sourcePath = path.join(workDir, `source${path.extname(upload.file_name) || ""}`);
  await writeFile(sourcePath, sourceBytes);
  const sourceDuration = await probeDuration(sourcePath);

  // --- Step 2: Analyze ---
  await setStatus(supabase, job.id, "analyzing");
  let transcript: Job["transcript"] = null;
  let audioAnalysis: Job["audio_analysis"] = null;

  if (upload.content_type === "spoken") {
    transcript = await transcribeAudio(sourceBytes);
    await supabase.from("jobs").update({ transcript }).eq("id", job.id);
  } else {
    audioAnalysis = await analyzeAudio(sourceBytes, upload.beat_sync_enabled);
    await supabase.from("jobs").update({ audio_analysis: audioAnalysis }).eq("id", job.id);
  }

  // --- Step 2.5: Generate visuals (feature-flagged) ---
  let visualSourcePath = sourcePath; // "has footage" path: cut directly from the upload
  let visualIsGenerated = false;
  let generatedWindowSeconds = sourceDuration;

  if (upload.visual_source === "generate") {
    await setStatus(supabase, job.id, "generating_visuals");
    generatedWindowSeconds = Math.min(sourceDuration, GENERATED_VISUAL_MAX_SECONDS);

    const { videoUrl } = await generateVisual({
      contentType: upload.content_type,
      moodDescription: upload.mood_description,
      style: upload.visual_style,
      durationSeconds: generatedWindowSeconds,
    });

    const genRes = await fetch(videoUrl);
    if (!genRes.ok) throw new Error(`Could not download generated visual (${genRes.status})`);
    const genBytes = Buffer.from(await genRes.arrayBuffer());
    const genPath = path.join(workDir, "generated.mp4");
    await writeFile(genPath, genBytes);

    // Re-host in our own storage rather than linking Higgsfield's URL directly,
    // so we control retention/redistribution regardless of their link lifetime.
    const rehostPath = `${upload.user_id}/generated/${job.id}.mp4`;
    await supabase.storage.from("uploads").upload(rehostPath, genBytes, { contentType: "video/mp4", upsert: true });

    visualSourcePath = genPath;
    visualIsGenerated = true;
    await supabase.from("jobs").update({ generated_visual_url: rehostPath }).eq("id", job.id);
  }

  // --- Step 3: Select segments ---
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

  let segments = await selectSegments(upload.content_type, scopedTranscript, scopedAnalysis);
  const preFilterCount = segments.length;
  segments = segments.filter((s) => s.end_time <= selectionWindow + 0.5);
  await supabase.from("jobs").update({ selected_segments: segments }).eq("id", job.id);

  if (segments.length === 0) {
    console.log(
      `[job ${job.id}] zero segments: contentType=${upload.content_type} sourceDuration=${sourceDuration} selectionWindow=${selectionWindow} preFilterCount=${preFilterCount} transcriptWords=${scopedTranscript?.words.length ?? "n/a"} analysisWindows=${scopedAnalysis?.windows.length ?? "n/a"}`,
    );
    throw new Error("No hook-worthy segments were found in this upload");
  }

  // Credit truthing: the first segment rides on create_job's initial
  // reservation; every additional segment must successfully claim its own
  // credit or gets dropped, so a job never produces more clips than the
  // user has credit for.
  const affordableSegments: SelectedSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const { data: claimed } = await supabase.rpc("claim_clip_credit", {
      p_user_id: job.user_id,
      p_generated: upload.visual_source === "generate",
    });
    if (!claimed) break;
    affordableSegments.push(segments[i]);
  }

  // --- Step 4: Cut, caption, reformat per platform ---
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
    await writeAssFile(assPath, buildAssDocument(cues, captionStyle));

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
        user_id: upload.user_id,
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
      user_id: upload.user_id,
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

  // --- Step 5: Deliver ---
  await setStatus(supabase, job.id, "done");
}
