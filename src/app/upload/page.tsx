"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Music, Mic, Film, Wand2, Upload as UploadIcon, Sparkles, Loader2, FileText,
} from "lucide-react";
import { StepPill } from "@/components/ui/StepPill";
import { PrimaryButton } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { AnimatedGroup } from "@/components/ui/motion-primitives/animated-group";
import { GlowEffect } from "@/components/ui/motion-primitives/glow-effect";
import type { AudioSource, ContentType, VisualSource } from "@/lib/database.types";

const GENERATE_VISUALS_ENABLED = process.env.NEXT_PUBLIC_GENERATE_VISUALS_ENABLED === "true";
const TTS_ENABLED = process.env.NEXT_PUBLIC_TTS_ENABLED === "true";
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB
const ACCEPTED_TYPES = [".mp4", ".mov", ".mp3", ".wav", ".m4a"];
const MAX_SCRIPT_CHARS = 2000;

interface Voice {
  voice_id: string;
  name: string;
}

export default function UploadPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [visualSource, setVisualSource] = useState<VisualSource | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>("upload");
  const [beatSync, setBeatSync] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [script, setScript] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [ttsVoiceId, setTtsVoiceId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mood, setMood] = useState("");
  const [genre, setGenre] = useState("");
  const [color, setColor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canContinue = !!contentType && !!visualSource;
  const canSubmit = audioSource === "upload" ? !!file : !!script.trim() && !!ttsVoiceId;

  useEffect(() => {
    if (audioSource !== "tts" || voices.length > 0 || voicesLoading) return;
    setVoicesLoading(true);
    setVoicesError(null);
    fetch("/api/tts/voices")
      .then((res) => res.json())
      .then((json) => {
        if (json.voices?.length) {
          setVoices(json.voices);
          setTtsVoiceId((prev) => prev || json.voices[0].voice_id);
        } else {
          setVoicesError(json.error ?? "No voices available.");
        }
      })
      .catch(() => setVoicesError("Could not load voices — please try again."))
      .finally(() => setVoicesLoading(false));
  }, [audioSource, voices.length, voicesLoading]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError("File is too large — max 500MB.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!contentType || !visualSource || !canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login?next=/upload");
        return;
      }

      let filePath: string | undefined;
      let fileName: string | undefined;

      if (audioSource === "upload") {
        if (!file) return;
        const ext = file.name.split(".").pop();
        filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        fileName = file.name;
        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(filePath, file, { contentType: file.type || undefined });

        if (uploadError) {
          console.error("Storage upload failed:", uploadError);
          setError(`Upload failed — ${uploadError.message}`);
          setSubmitting(false);
          return;
        }
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          visual_source: visualSource,
          audio_source: audioSource,
          file_path: filePath,
          file_name: fileName,
          script_text: audioSource === "tts" ? script.trim() : undefined,
          tts_voice_id: audioSource === "tts" ? ttsVoiceId : undefined,
          mood_description: mood || undefined,
          beat_sync_enabled: beatSync,
          visual_style:
            visualSource === "generate"
              ? { prompt: prompt || undefined, mood: mood || undefined, genre: genre || undefined, color: color || undefined }
              : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }

      showToast("Upload received — building your clips");
      router.push(`/jobs/${json.job.id}`);
    } catch {
      setError("Something went wrong — please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="nova-fade-in max-w-xl mx-auto px-6 py-14 w-full">
      <Link href="/dashboard" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>

      <div className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <StepPill n={1} label="Content" active={!contentType} done={!!contentType} />
          <div className="w-5 h-px bg-line" />
          <StepPill n={2} label="Visuals" active={!!contentType && !visualSource} done={!!visualSource} />
          <div className="w-5 h-px bg-line" />
          <StepPill n={3} label="Upload" active={canContinue} done={false} />
        </div>
      </div>

      {!contentType && (
        <div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
            What are you posting?
          </TextEffect>
          <p className="mb-6 text-muted text-[14px]">This decides how Velora Studio reads your upload.</p>
          <AnimatedGroup preset="blur-slide" className="grid grid-cols-2 gap-3">
            <button onClick={() => setContentType("music")} className="nova-card nova-card-select rounded-2xl p-5 text-left">
              <Music size={20} className="text-violet mb-3" />
              <div className="nova-display font-medium text-[15px] text-text">Music</div>
              <div className="text-[12.5px] text-muted mt-0.5">A song or track</div>
            </button>
            <button onClick={() => setContentType("spoken")} className="nova-card nova-card-select rounded-2xl p-5 text-left">
              <Mic size={20} className="text-coral mb-3" />
              <div className="nova-display font-medium text-[15px] text-text">Talking / spoken</div>
              <div className="text-[12.5px] text-muted mt-0.5">Voiceover, podcast, script</div>
            </button>
          </AnimatedGroup>
        </div>
      )}

      {contentType && !visualSource && (
        <div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
            Do you have footage?
          </TextEffect>
          <p className="mb-6 text-muted text-[14px]">No camera, no footage, no problem — Velora Studio can build visuals for you.</p>
          <AnimatedGroup preset="blur-slide" className="grid grid-cols-2 gap-3">
            <button onClick={() => setVisualSource("has")} className="nova-card nova-card-select rounded-2xl p-5 text-left">
              <Film size={20} className="text-violet mb-3" />
              <div className="nova-display font-medium text-[15px] text-text">I have footage</div>
              <div className="text-[12.5px] text-muted mt-0.5">Edit and reformat what I upload</div>
            </button>
            <button
              onClick={() => GENERATE_VISUALS_ENABLED && setVisualSource("generate")}
              disabled={!GENERATE_VISUALS_ENABLED}
              className="nova-card nova-card-select rounded-2xl p-5 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              <Wand2 size={20} className="text-coral mb-3" />
              <div className="nova-display font-medium text-[15px] text-text">Generate for me</div>
              <div className="text-[12.5px] text-muted mt-0.5">
                {GENERATE_VISUALS_ENABLED ? "Build visuals that match the mood" : "Temporarily unavailable"}
              </div>
            </button>
          </AnimatedGroup>
        </div>
      )}

      {canContinue && (
        <div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" trigger={true} className="nova-display font-semibold mb-1 text-[22px] text-text">
            {audioSource === "tts" ? "Write your script" : `Upload your ${contentType === "music" ? "track" : "video or audio"}`}
          </TextEffect>
          <p className="mb-6 text-muted text-[14px]">
            {audioSource === "tts"
              ? "We'll turn this into a voiceover, then find the best moments to clip."
              : visualSource === "generate"
                ? "Just the audio is fine — we'll build the rest."
                : "We'll pull the best moments straight from this."}
          </p>

          {contentType === "spoken" && TTS_ENABLED && (
            <div className="grid grid-cols-2 gap-2 mb-5 p-1 rounded-xl border border-line">
              {(["upload", "tts"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setAudioSource(s)}
                  className="rounded-lg py-2 text-[13px] nova-display font-medium transition-colors"
                  style={{
                    background: audioSource === s ? "var(--violet-soft)" : "transparent",
                    color: audioSource === s ? "var(--violet)" : "var(--muted)",
                  }}
                >
                  {s === "upload" ? "Upload a recording" : "Write a script"}
                </button>
              ))}
            </div>
          )}

          {contentType === "music" && (
            <label className="flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 mb-4 border border-line cursor-pointer">
              <div>
                <div className="text-[13.5px] text-text">Sync cuts &amp; captions to the beat</div>
                <div className="text-[12px] text-muted mt-0.5">Detects BPM and snaps every cut to the rhythm</div>
              </div>
              <input
                type="checkbox"
                checked={beatSync}
                onChange={(e) => setBeatSync(e.target.checked)}
                className="w-5 h-5 accent-violet shrink-0"
              />
            </label>
          )}

          {audioSource === "tts" ? (
            <div className="flex flex-col gap-2.5 mb-4">
              <div>
                <label className="block text-[13px] text-text mb-1.5">Script</label>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="Type what you want the voiceover to say…"
                  rows={6}
                  maxLength={MAX_SCRIPT_CHARS}
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] resize-none"
                />
                <div className="text-[11.5px] text-muted mt-1">{script.length}/{MAX_SCRIPT_CHARS}</div>
              </div>
              <div>
                <label className="block text-[13px] text-text mb-1.5">Voice</label>
                {voicesLoading ? (
                  <div className="flex items-center gap-2 text-[13px] text-muted py-3">
                    <Loader2 size={14} className="animate-spin" /> Loading voices…
                  </div>
                ) : voicesError ? (
                  <p className="text-[12.5px] text-coral">{voicesError}</p>
                ) : (
                  <select
                    value={ttsVoiceId}
                    onChange={(e) => setTtsVoiceId(e.target.value)}
                    aria-label="Voice"
                    className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
                  >
                    {voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer mb-4 py-9 px-5"
              style={{
                border: `1.5px dashed ${file ? "var(--violet)" : "var(--line)"}`,
                background: file ? "var(--violet-soft)" : "transparent",
              }}
            >
              <input ref={fileRef} type="file" className="hidden" accept={ACCEPTED_TYPES.join(",")} onChange={handleFile} />
              <UploadIcon size={22} className={file ? "text-violet" : "text-muted"} />
              <div className="text-[14px] text-text mt-2">{file?.name ?? "Click to choose a file"}</div>
              <div className="text-[12px] text-muted mt-1">{file ? "Ready to process" : "MP4, MOV, MP3, or WAV — up to 500MB"}</div>
            </div>
          )}

          {visualSource === "generate" && (
            <div className="flex flex-col gap-2.5 mb-4">
              <div>
                <label className="block text-[13px] text-text mb-1.5">Describe what you want (optional)</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. a rooftop at golden hour, city skyline in the background, warm cinematic lighting"
                  rows={3}
                  maxLength={400}
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] resize-none"
                />
                <div className="text-[11.5px] text-muted mt-1">The more specific, the closer the AI-generated visual matches what you're picturing.</div>
              </div>
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="Mood or vibe (e.g. moody, upbeat, cinematic)"
                aria-label="Mood or vibe"
                className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Genre (optional)"
                  aria-label="Genre"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
                />
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Color palette (optional)"
                  aria-label="Color palette"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
                />
              </div>
            </div>
          )}

          {error && <p className="text-[12.5px] text-coral mb-3">{error}</p>}

          <div className="relative">
            {canSubmit && !submitting && (
              <GlowEffect
                colors={["#A855F7", "#D4AF37", "#E63946"]}
                mode="breathe"
                blur="soft"
                scale={0.96}
                duration={4}
                className="opacity-60 rounded-xl"
              />
            )}
            <PrimaryButton disabled={!canSubmit || submitting} onClick={handleSubmit} className="relative w-full py-3.5 text-[15px]">
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Uploading…
                </>
              ) : audioSource === "tts" ? (
                <>
                  Generate my clips <FileText size={16} />
                </>
              ) : (
                <>
                  Generate my clips <Sparkles size={16} />
                </>
              )}
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
