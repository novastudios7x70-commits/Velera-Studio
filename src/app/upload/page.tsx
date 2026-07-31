"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Music, Mic, Film, Wand2, Upload as UploadIcon, Sparkles, Loader2,
} from "lucide-react";
import { StepPill } from "@/components/ui/StepPill";
import { PrimaryButton } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import type { ContentType, VisualSource } from "@/lib/database.types";

const GENERATE_VISUALS_ENABLED = process.env.NEXT_PUBLIC_GENERATE_VISUALS_ENABLED === "true";
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB
const ACCEPTED_TYPES = [".mp4", ".mov", ".mp3", ".wav", ".m4a"];

export default function UploadPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [visualSource, setVisualSource] = useState<VisualSource | null>(null);
  const [beatSync, setBeatSync] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mood, setMood] = useState("");
  const [genre, setGenre] = useState("");
  const [color, setColor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canContinue = !!contentType && !!visualSource;

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
    if (!file || !contentType || !visualSource) return;
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

      const ext = file.name.split(".").pop();
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(path, file, { contentType: file.type || undefined });

      if (uploadError) {
        setError("Upload failed — please try again.");
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: path,
          file_name: file.name,
          content_type: contentType,
          visual_source: visualSource,
          mood_description: mood || undefined,
          beat_sync_enabled: beatSync,
          visual_style:
            visualSource === "generate"
              ? { mood: mood || undefined, genre: genre || undefined, color: color || undefined }
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
          <h1 className="nova-display font-semibold mb-1 text-[22px] text-text">What are you posting?</h1>
          <p className="mb-6 text-muted text-[14px]">This decides how Velora Studio reads your upload.</p>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
        </div>
      )}

      {contentType && !visualSource && (
        <div>
          <h1 className="nova-display font-semibold mb-1 text-[22px] text-text">Do you have footage?</h1>
          <p className="mb-6 text-muted text-[14px]">No camera, no footage, no problem — Velora Studio can build visuals for you.</p>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
        </div>
      )}

      {canContinue && (
        <div>
          <h1 className="nova-display font-semibold mb-1 text-[22px] text-text">
            Upload your {contentType === "music" ? "track" : "video or audio"}
          </h1>
          <p className="mb-6 text-muted text-[14px]">
            {visualSource === "generate" ? "Just the audio is fine — we'll build the rest." : "We'll pull the best moments straight from this."}
          </p>

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

          {visualSource === "generate" && (
            <div className="flex flex-col gap-2.5 mb-4">
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="Mood or vibe (e.g. moody, upbeat, cinematic)"
                className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Genre (optional)"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
                />
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Color palette (optional)"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
                />
              </div>
            </div>
          )}

          {error && <p className="text-[12.5px] text-coral mb-3">{error}</p>}

          <PrimaryButton disabled={!file || submitting} onClick={handleSubmit} className="w-full py-3.5 text-[15px]">
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Uploading…
              </>
            ) : (
              <>
                Generate my clips <Sparkles size={16} />
              </>
            )}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
