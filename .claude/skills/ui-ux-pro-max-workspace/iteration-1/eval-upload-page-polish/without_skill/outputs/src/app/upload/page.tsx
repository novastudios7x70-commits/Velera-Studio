"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Music, Mic, Film, Wand2, UploadCloud, Sparkles, Loader2,
  Pencil, X, FileAudio, FileVideo2, Clock,
} from "lucide-react";
import { StepPill } from "@/components/ui/StepPill";
import { PrimaryButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import type { ContentType, VisualSource } from "@/lib/database.types";

const GENERATE_VISUALS_ENABLED = process.env.NEXT_PUBLIC_GENERATE_VISUALS_ENABLED === "true";
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB
const ACCEPTED_TYPES = [".mp4", ".mov", ".mp3", ".wav", ".m4a"];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canContinue = !!contentType && !!visualSource;
  const stepIndex = canContinue ? 3 : contentType ? 2 : 1;
  const trackFill = stepIndex >= 2 ? "100%" : "0%";
  const trackFill2 = stepIndex >= 3 ? "100%" : "0%";

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError("File is too large — max 500MB.");
      return;
    }
    const ext = `.${f.name.split(".").pop()?.toLowerCase()}`;
    if (!ACCEPTED_TYPES.includes(ext)) {
      setError("Unsupported file type — use MP4, MOV, MP3, WAV, or M4A.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => acceptFile(e.target.files?.[0]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const editContentType = () => {
    setContentType(null);
    setVisualSource(null);
  };

  const editVisualSource = () => setVisualSource(null);

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
    <div className="relative max-w-xl mx-auto px-6 py-14 w-full">
      <div
        className="nova-pulse-glow absolute pointer-events-none -z-10"
        style={{
          top: -60,
          left: "50%",
          transform: "translateX(-50%)",
          width: 460,
          height: 320,
          borderRadius: "50%",
          background: "radial-gradient(circle, var(--violet-soft), transparent 70%)",
          filter: "blur(30px)",
        }}
      />

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 mb-8 text-muted text-[13px] transition-colors hover:text-text"
      >
        <ArrowLeft size={14} /> back
      </Link>

      <div className="mb-4">
        <div className="flex items-center gap-2.5">
          <StepPill n={1} label="Content" active={!contentType} done={!!contentType} />
          <div className="nova-step-track" style={{ "--fill": trackFill } as React.CSSProperties}>
            <div className="nova-step-track-fill" />
          </div>
          <StepPill n={2} label="Visuals" active={!!contentType && !visualSource} done={!!visualSource} />
          <div className="nova-step-track" style={{ "--fill": trackFill2 } as React.CSSProperties}>
            <div className="nova-step-track-fill" />
          </div>
          <StepPill n={3} label="Upload" active={canContinue} done={false} />
        </div>
      </div>

      {(contentType || visualSource) && (
        <div className="nova-fade-in flex flex-wrap items-center gap-2 mb-8">
          {contentType && (
            <button onClick={editContentType} className="nova-chip transition-colors hover:border-violet/40 hover:text-text">
              {contentType === "music" ? <Music size={11} /> : <Mic size={11} />}
              {contentType === "music" ? "Music" : "Talking / spoken"}
              <Pencil size={10} className="opacity-60" />
            </button>
          )}
          {visualSource && (
            <button onClick={editVisualSource} className="nova-chip transition-colors hover:border-violet/40 hover:text-text">
              {visualSource === "has" ? <Film size={11} /> : <Wand2 size={11} />}
              {visualSource === "has" ? "I have footage" : "Generate for me"}
              <Pencil size={10} className="opacity-60" />
            </button>
          )}
        </div>
      )}

      {!contentType && (
        <div key="step-1" className="nova-fade-in">
          <h1 className="nova-display font-semibold mb-1.5 text-[24px] text-text tracking-[-0.01em]">What are you posting?</h1>
          <p className="mb-7 text-muted text-[14px] leading-relaxed">This decides how Velora Studio reads your upload.</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setContentType("music")} className="nova-card nova-card-select rounded-2xl p-5 text-left">
              <div className="nova-icon-badge mb-4" style={{ background: "var(--violet-soft)" }}>
                <Music size={18} className="text-violet" />
              </div>
              <div className="nova-display font-medium text-[15px] text-text">Music</div>
              <div className="text-[12.5px] text-muted mt-0.5">A song or track</div>
            </button>
            <button onClick={() => setContentType("spoken")} className="nova-card nova-card-select rounded-2xl p-5 text-left">
              <div className="nova-icon-badge mb-4" style={{ background: "rgba(245,165,36,0.14)" }}>
                <Mic size={18} className="text-coral" />
              </div>
              <div className="nova-display font-medium text-[15px] text-text">Talking / spoken</div>
              <div className="text-[12.5px] text-muted mt-0.5">Voiceover, podcast, script</div>
            </button>
          </div>
        </div>
      )}

      {contentType && !visualSource && (
        <div key="step-2" className="nova-fade-in">
          <h1 className="nova-display font-semibold mb-1.5 text-[24px] text-text tracking-[-0.01em]">Do you have footage?</h1>
          <p className="mb-7 text-muted text-[14px] leading-relaxed">
            No camera, no footage, no problem — Velora Studio can build visuals for you.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setVisualSource("has")} className="nova-card nova-card-select rounded-2xl p-5 text-left">
              <div className="nova-icon-badge mb-4" style={{ background: "var(--violet-soft)" }}>
                <Film size={18} className="text-violet" />
              </div>
              <div className="nova-display font-medium text-[15px] text-text">I have footage</div>
              <div className="text-[12.5px] text-muted mt-0.5">Edit and reformat what I upload</div>
            </button>
            <button
              onClick={() => GENERATE_VISUALS_ENABLED && setVisualSource("generate")}
              disabled={!GENERATE_VISUALS_ENABLED}
              className="nova-card nova-card-select rounded-2xl p-5 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              <div className="nova-icon-badge mb-4" style={{ background: "rgba(245,165,36,0.14)" }}>
                <Wand2 size={18} className="text-coral" />
              </div>
              <div className="nova-display font-medium text-[15px] text-text">Generate for me</div>
              <div className="text-[12.5px] text-muted mt-0.5">
                {GENERATE_VISUALS_ENABLED ? "Build visuals that match the mood" : "Temporarily unavailable"}
              </div>
            </button>
          </div>
        </div>
      )}

      {canContinue && (
        <div key="step-3" className="nova-fade-in">
          <h1 className="nova-display font-semibold mb-1.5 text-[24px] text-text tracking-[-0.01em]">
            Upload your {contentType === "music" ? "track" : "video or audio"}
          </h1>
          <p className="mb-7 text-muted text-[14px] leading-relaxed">
            {visualSource === "generate" ? "Just the audio is fine — we'll build the rest." : "We'll pull the best moments straight from this."}
          </p>

          {contentType === "music" && (
            <div className="nova-card flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 mb-4">
              <div>
                <div className="text-[13.5px] text-text">Sync cuts &amp; captions to the beat</div>
                <div className="text-[12px] text-muted mt-0.5">Detects BPM and snaps every cut to the rhythm</div>
              </div>
              <Switch checked={beatSync} onChange={setBeatSync} id="beat-sync" />
            </div>
          )}

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`nova-dropzone rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer mb-4 py-10 px-5 ${
              dragActive ? "nova-dropzone-active" : ""
            }`}
            style={{
              border: `1.5px dashed ${file ? "var(--violet)" : "var(--line)"}`,
              background: file ? "var(--violet-soft)" : "var(--panel)",
            }}
          >
            <input ref={fileRef} type="file" className="hidden" accept={ACCEPTED_TYPES.join(",")} onChange={handleFile} />

            {file ? (
              <>
                <div className="nova-icon-badge mb-3" style={{ background: "rgba(20,184,166,0.18)" }}>
                  {file.type.startsWith("audio") || /\.(mp3|wav|m4a)$/i.test(file.name) ? (
                    <FileAudio size={19} className="text-violet" />
                  ) : (
                    <FileVideo2 size={19} className="text-violet" />
                  )}
                </div>
                <div className="text-[14px] text-text font-medium max-w-[80%] truncate">{file.name}</div>
                <div className="text-[12px] text-muted mt-1">{formatBytes(file.size)} — ready to process</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="nova-chip mt-3.5 hover:border-coral/40 hover:text-text transition-colors"
                >
                  <X size={11} /> Remove
                </button>
              </>
            ) : (
              <>
                <div className="nova-icon-badge mb-3" style={{ background: "var(--line)" }}>
                  <UploadCloud size={19} className="text-muted" />
                </div>
                <div className="text-[14px] text-text">
                  <span className="text-violet font-medium">Click to upload</span> or drag and drop
                </div>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap justify-center">
                  {["MP4", "MOV", "MP3", "WAV", "M4A"].map((t) => (
                    <span key={t} className="nova-chip py-1 px-2 text-[10.5px]">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="text-[11.5px] text-muted mt-2.5">Up to 500MB</div>
              </>
            )}
          </div>

          {visualSource === "generate" && (
            <div className="flex flex-col gap-2.5 mb-4">
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="Mood or vibe (e.g. moody, upbeat, cinematic)"
                className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] transition-colors focus:border-violet/50"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Genre (optional)"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] transition-colors focus:border-violet/50"
                />
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Color palette (optional)"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] transition-colors focus:border-violet/50"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-[12.5px] text-coral mb-3 flex items-center gap-1.5">
              <X size={12} className="shrink-0" /> {error}
            </p>
          )}

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
          <div className="flex items-center justify-center gap-1.5 mt-3.5 text-muted text-[12px]">
            <Clock size={11} /> Clips are usually ready in a few minutes
          </div>
        </div>
      )}
    </div>
  );
}
