import { env } from "../lib/env.js";
import type { Transcript, TranscriptWord } from "../lib/database.types.js";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — generous for long uploads

async function assemblyAiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${ASSEMBLYAI_BASE}${path}`, {
    ...init,
    headers: { authorization: env.assemblyAiApiKey, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AssemblyAI request failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Transcribes spoken content into a word-level timestamped transcript.
 * `fileBytes` is the raw audio/video downloaded from our own Supabase
 * Storage bucket — AssemblyAI needs its own upload URL, it can't read our
 * private bucket directly.
 */
export async function transcribeAudio(fileBytes: Buffer): Promise<Transcript> {
  const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: "POST",
    headers: { authorization: env.assemblyAiApiKey },
    body: new Uint8Array(fileBytes),
  });
  if (!uploadRes.ok) {
    throw new Error(`AssemblyAI upload failed (${uploadRes.status})`);
  }
  const { upload_url: uploadUrl } = (await uploadRes.json()) as { upload_url: string };

  const transcript = (await assemblyAiFetch("/transcript", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audio_url: uploadUrl, punctuate: true, format_text: true }),
  })) as { id: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = (await assemblyAiFetch(`/transcript/${transcript.id}`)) as {
      status: "queued" | "processing" | "completed" | "error";
      text?: string;
      words?: { text: string; start: number; end: number }[];
      error?: string;
    };

    if (result.status === "completed") {
      const words: TranscriptWord[] = (result.words ?? []).map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
      }));
      return { full_text: result.text ?? "", words };
    }
    if (result.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${result.error}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("AssemblyAI transcription timed out");
}
