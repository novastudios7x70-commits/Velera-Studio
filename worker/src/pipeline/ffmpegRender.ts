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
      .outputOptions([
        "-ss", String(startSec),
        "-t", String(duration),
        "-map", "0:v:0",
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
      .videoFilters(vf)
      .output(outputPath)
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
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [Math.max(0, atSeconds)],
        filename: outputPath.split("/").pop(),
        folder: outputPath.split("/").slice(0, -1).join("/") || ".",
      })
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });
}

export async function writeAssFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, "utf-8");
}
