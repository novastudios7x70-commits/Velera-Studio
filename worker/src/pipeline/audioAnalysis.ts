import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AudioAnalysis } from "../lib/database.types.js";

const SCRIPT_PATH = new URL("../../scripts/audio_analysis.py", import.meta.url).pathname;
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

// Unlike ffprobe's metadata-only read, librosa decodes and processes the
// full waveform, so runtime scales with audio duration — 5 minutes is
// generous for anything the app's own upload flow produces (well short of
// AssemblyAI's 15-minute transcription poll, which is a genuinely different
// kind of wait: a remote job AssemblyAI itself bounds, versus a local
// CPU-bound analysis this process controls directly), while still bounding
// a hang on a crafted/malformed file instead of tying up a worker slot
// indefinitely.
const AUDIO_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs the librosa-based energy/mood + beat-tracking analysis (see
 * scripts/audio_analysis.py) against the raw uploaded audio.
 */
export async function analyzeAudio(fileBytes: Buffer, withBeatGrid: boolean): Promise<AudioAnalysis> {
  const dir = await mkdtemp(path.join(tmpdir(), "velora-audio-"));
  const inputPath = path.join(dir, "input");

  try {
    await writeFile(inputPath, fileBytes);

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(PYTHON_BIN, [SCRIPT_PATH, inputPath, withBeatGrid ? "1" : "0"]);
      let out = "";
      let err = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`audio_analysis.py timed out after ${AUDIO_ANALYSIS_TIMEOUT_MS}ms`));
      }, AUDIO_ANALYSIS_TIMEOUT_MS);

      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`audio_analysis.py exited with code ${code}: ${err}`));
      });
    });

    return JSON.parse(stdout) as AudioAnalysis;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
