import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AudioAnalysis } from "../lib/database.types.js";

const SCRIPT_PATH = new URL("../../scripts/audio_analysis.py", import.meta.url).pathname;
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

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
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`audio_analysis.py exited with code ${code}: ${err}`));
      });
    });

    return JSON.parse(stdout) as AudioAnalysis;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
