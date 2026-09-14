import ffmpeg from "fluent-ffmpeg";
import { writeFile } from "node:fs/promises";
import type { BeatGrid } from "../lib/database.types.js";

export interface RenderTarget {
  name: "vertical" | "pinterest";
  width: number;
  height: number;
}

export const VERTICAL_TARGET: RenderTarget = { name: "vertical", width: 1080, height: 1920 };
export const PINTEREST_TARGET: RenderTarget = { name: "pinterest", width: 1000, height: 1500 };

/**
 * Snaps a segment's cut points to the nearest detected beat when beat-sync
 * is enabled, instead of cutting at the LLM/heuristic's arbitrary time.
 */
export function snapToBeats(startSec: number, endSec: number, beatGrid?: BeatGrid): { start: number; end: number } {
  if (!beatGrid || beatGrid.beat_timestamps.length === 0) return { start: startSec, end: endSec };
  const beats = beatGrid.beat_timestamps;

  const nearest = (t: number) =>
    beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]);

  const start = nearest(startSec);
  let end = nearest(endSec);
  if (end <= start) end = start + (endSec - startSec); // guard against collapsing to a zero-length clip
  return { start, end };
}

function escapeFfmpegPath(p: string): string {
  // ffmpeg's filter graph treats ':' and other chars specially inside filter args
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Cuts [start,end] out of the source, scales+crops to fill the target
 * aspect ratio, burns in the given .ass subtitle file, and encodes h264/aac.
 */
export async function renderClip(params: {
  inputPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  assPath: string;
  target: RenderTarget;
}): Promise<void> {
  const { inputPath, outputPath, startSec, endSec, assPath, target } = params;
  const duration = Math.max(endSec - startSec, 1);
  const vf = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase`,
    `crop=${target.width}:${target.height}`,
    "setsar=1",
    `subtitles='${escapeFfmpegPath(assPath)}'`,
  ].join(",");

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSec)
      .setDuration(duration)
      .videoFilters(vf)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "ultrafast", // lower memory/CPU footprint than veryfast — matters on constrained worker instances
        "-threads", "1", // bounds x264's per-thread frame buffers, the main driver of encode-time memory use
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

/**
 * Silent-source variant for generated-visual clips with no source audio
 * track to preserve — cuts the segment's audio from the original upload but
 * pairs it with the (much shorter) Higgsfield-generated visual.
 *
 * The visual input is looped indefinitely (-stream_loop -1) since the
 * generated clip is only a few seconds long while segments can start
 * anywhere up to GENERATED_VISUAL_MAX_SECONDS into the source; without
 * looping, a segment starting past the generated clip's own length would
 * have no video left to seek into. The seek/duration are applied as output
 * options (not input-side .setStartTime) specifically so they land on the
 * looped/decoded stream rather than trying to fast-seek a single short file
 * past its own end.
 */
export async function renderClipWithAudioTrack(params: {
  inputPath: string;
  audioPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  assPath: string;
  target: RenderTarget;
}): Promise<void> {
  const { inputPath, audioPath, outputPath, startSec, endSec, assPath, target } = params;
  const duration = Math.max(endSec - startSec, 1);
  const vf = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase`,
    `crop=${target.width}:${target.height}`,
    "setsar=1",
    `subtitles='${escapeFfmpegPath(assPath)}'`,
  ].join(",");

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .inputOptions(["-stream_loop", "-1"])
      .input(audioPath)
      // A simple filter (-vf/.videoFilters()) combined with an explicit
      // -map across two inputs is a known-fragile ffmpeg combination: ffmpeg
      // auto-inserts a `split` to reconcile its own simple-filtergraph
      // stream-selection against the explicit -map, and that reconciliation
      // can fail outright ("Cannot find a matching stream for unlabeled
      // input pad 0 on filter Parsed_split_0"). Naming the filtered video's
      // own output pad ([vout]) and mapping that label directly removes the
      // ambiguity entirely — same filter chain, same options, just no
      // automatic pad-resolution for ffmpeg to get wrong.
      .complexFilter(`[0:v:0]${vf}[vout]`)
      .outputOptions([
        "-ss", String(startSec),
        "-t", String(duration),
        "-map", "[vout]",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-preset", "ultrafast", // lower memory/CPU footprint than veryfast — matters on constrained worker instances
        "-threads", "1", // bounds x264's per-thread frame buffers, the main driver of encode-time memory use
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      // TEMPORARY DIAGNOSTIC — remove once the production Parsed_split_0
      // investigation is resolved. Logs the exact command fluent-ffmpeg is
      // about to run (file paths only — no API keys, env vars, or
      // credentials ever pass through this command).
      .on("start", (commandLine) => console.log(`[render] FFmpeg command: ${commandLine}`))
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function extractThumbnail(videoPath: string, outputPath: string): Promise<void> {
  await extractThumbnailAt(videoPath, outputPath, 1);
}

/**
 * Same as extractThumbnail but at an arbitrary offset into videoPath —
 * used on Discover to grab a real preview frame from inside the *source*
 * video at each candidate moment's own start time, rather than frame 1 of
 * whatever file is passed in (which is all the original function needed,
 * since it only ever ran on an already-cut short clip).
 */
export async function extractThumbnailAt(videoPath: string, outputPath: string, atSeconds: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // fluent-ffmpeg's .screenshots() helper (used here previously) always
    // builds its own -filter_complex containing a `split` filter — even for
    // a single timestamp — and only gives that filter an explicit input
    // label when a `size` option is passed (which this call never did).
    // Without that label, ffmpeg has to auto-resolve the split's input pad,
    // which is exactly what fails with "Cannot find a matching stream for
    // unlabeled input pad 0 on filter Parsed_split_0". A single frame from a
    // single input never needed the split helper's multi-output fan-out
    // capability in the first place, so this extracts it directly — a plain
    // seek + one-frame grab, with no filtergraph (and thus no split, no
    // input-pad ambiguity) at all.
    ffmpeg(videoPath)
      .inputOptions(["-ss", String(Math.max(0, atSeconds))])
      // Removing .screenshots() (above) also removed its always-present
      // explicit -map (it mapped the split filter's own output pad) —
      // without it, ffmpeg's automatic stream selection wasn't picking any
      // stream at all for this image2 output, failing with "Output file #0
      // does not contain any stream". Mapping the input's video stream
      // directly restores an explicit selection, same as before.
      .outputOptions(["-map", "0:v:0", "-frames:v", "1"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function writeAssFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, "utf-8");
}
