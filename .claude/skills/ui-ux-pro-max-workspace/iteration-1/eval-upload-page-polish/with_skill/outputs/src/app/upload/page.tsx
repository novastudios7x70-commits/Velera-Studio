"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft, Music, Mic, Film, Wand2, Upload as UploadIcon, Sparkles, Loader2,
  ChevronRight, CheckCircle2, AlertCircle, Palette, ShieldCheck,
} from "lucide-react";
import { StepPill } from "@/components/ui/StepPill";
import { PrimaryButton } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import type { ContentType, VisualSource } from "@/lib/database.types";

const GENERATE_VISUALS_ENABLED = process.env.NEXT_PUBLIC_GENERATE_VISUALS_ENABLED === "true";
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB
const ACCEPTED_TYPES = [".mp4", ".mov", ".mp3", ".wav", ".m4a"];

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="nova-mono text-[11px] text-violet uppercase tracking-[0.14em] mb-2.5">
      {children}
    </div>
  );
}

function OptionCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="nova-card nova-card-select group relative rounded-2xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-105"
        style={{ background: iconBg }}
      >
        <Icon size={18} style={{ color: iconColor }} />
      </div>
      <div className="nova-display font-medium text-[15px] text-text pr-4">{title}</div>
      <div className="text-[12.5px] text-muted mt-1 leading-relaxed pr-4">{description}</div>
      <ChevronRight
        size={15}
        className="absolute top-5 right-5 text-muted opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
      />
    </button>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [visualSource, setVisualSource] = useState<VisualSource | null>(null);
  const [beatSync, setBeatSync] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mood, setMood] = useState("");
  const [genre, setGenre] = useState("");
  const [color, setColor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canContinue = !!contentType && !!visualSource;

  const goToStep = (step: 1 | 2) => {
    setError(null);
    if (step === 1) {
      setContentType(null);
      setVisualSource(null);
      setFile(null);
    } else {
      setVisualSource(null);
      setFile(null);
    }
  };

  const acceptFile = (f: File) => {
    if (f.size > MAX_FILE_BYTES) {
      setError("File is too large — max 500MB.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const clearFile = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
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
    <div className="nova-fade-in max-w-xl mx-auto px-6 py-14 w-full relative">
      <div
        className="nova-pulse-glow absolute pointer-events-none -z-10"
        style={{
          top: -60,
          left: "50%",
          transform: "translateX(-50%)",
          width: 460,
          height: 460,
          borderRadius: "50%",
          background: "radial-gradient(circle, var(--violet-soft), transparent 70%)",
          filter: "blur(30px)",
        }}
      />

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 mb-8 text-muted text-[13px] transition-colors hover:text-text"
      >
        <ArrowLeft size={14} /> Back to dashboard
      </Link>

      <div className="mb-10">
        <div className="flex items-center gap-2.5">
          <StepPill
            n={1}
            label="Content"
            active={!contentType}
            done={!!contentType}
            onClick={contentType ? () => goToStep(1) : undefined}
          />
          <div
            className="flex-1 h-px transition-colors duration-300"
            style={{ background: contentType ? "var(--violet)" : "var(--line)" }}
          />
          <StepPill
            n={2}
            label="Visuals"
            active={!!contentType && !visualSource}
            done={!!visualSource}
            onClick={visualSource ? () => goToStep(2) : undefined}
          />
          <div
            className="flex-1 h-px transition-colors duration-300"
            style={{ background: visualSource ? "var(--violet)" : "var(--line)" }}
          />
          <StepPill n={3} label="Upload" active={canContinue} done={false} />
        </div>
      </div>

      {!contentType && (
        <div key="step-1" className="nova-fade-in">
          <Eyebrow>Step 1 of 3</Eyebrow>
          <h1 className="nova-display font-semibold mb-1 text-[24px] text-text tracking-[-0.01em]">
            What are you posting?
          </h1>
          <p className="mb-7 text-muted text-[14px]">This decides how Velora Studio reads your upload.</p>
          <div className="grid grid-cols-2 gap-3">
            <OptionCard
              icon={Music}
              iconBg="var(--violet-soft)"
              iconColor="var(--violet)"
              title="Music"
              description="A song or track"
              onClick={() => setContentType("music")}
            />
            <OptionCard
              icon={Mic}
              iconBg="rgba(245,165,36,0.14)"
              iconColor="var(--coral)"
              title="Talking / spoken"
              description="Voiceover, podcast, script"
              onClick={() => setContentType("spoken")}
            />
          </div>
        </div>
      )}

      {contentType && !visualSource && (
        <div key="step-2" className="nova-fade-in">
          <Eyebrow>Step 2 of 3</Eyebrow>
          <h1 className="nova-display font-semibold mb-1 text-[24px] text-text tracking-[-0.01em]">
            Do you have footage?
          </h1>
          <p className="mb-7 text-muted text-[14px]">
            No camera, no footage, no problem — Velora Studio can build visuals for you.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <OptionCard
              icon={Film}
              iconBg="var(--violet-soft)"
              iconColor="var(--violet)"
              title="I have footage"
              description="Edit and reformat what I upload"
              onClick={() => setVisualSource("has")}
            />
            <OptionCard
              icon={Wand2}
              iconBg="rgba(245,165,36,0.14)"
              iconColor="var(--coral)"
              title="Generate for me"
              description={GENERATE_VISUALS_ENABLED ? "Build visuals that match the mood" : "Temporarily unavailable"}
              onClick={() => GENERATE_VISUALS_ENABLED && setVisualSource("generate")}
              disabled={!GENERATE_VISUALS_ENABLED}
            />
          </div>
        </div>
      )}

      {canContinue && (
        <div key="step-3" className="nova-fade-in">
          <Eyebrow>Step 3 of 3</Eyebrow>
          <h1 className="nova-display font-semibold mb-1 text-[24px] text-text tracking-[-0.01em]">
            Upload your {contentType === "music" ? "track" : "video or audio"}
          </h1>
          <p className="mb-7 text-muted text-[14px]">
            {visualSource === "generate"
              ? "Just the audio is fine — we'll build the rest."
              : "We'll pull the best moments straight from this."}
          </p>

          {contentType === "music" && (
            <label className="nova-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 mb-4 cursor-pointer transition-colors hover:border-violet/30">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "var(--violet-soft)" }}
                >
                  <Music size={15} className="text-violet" />
                </div>
                <div>
                  <div className="text-[13.5px] text-text">Sync cuts &amp; captions to the beat</div>
                  <div className="text-[12px] text-muted mt-0.5">Detects BPM and snaps every cut to the rhythm</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={beatSync}
                onChange={(e) => setBeatSync(e.target.checked)}
                className="w-5 h-5 accent-violet shrink-0"
                aria-label="Sync cuts and captions to the beat"
              />
            </label>
          )}

          <label
            htmlFor="file-upload"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className="relative flex flex-col items-center justify-center text-center cursor-pointer mb-4 py-10 px-5 rounded-2xl transition-colors duration-150 focus-within:ring-2 focus-within:ring-violet/40"
            style={{
              border: `1.5px dashed ${file || isDragging ? "var(--violet)" : "var(--line)"}`,
              background: file ? "var(--violet-soft)" : isDragging ? "rgba(20,184,166,0.06)" : "transparent",
            }}
          >
            <input
              ref={fileRef}
              id="file-upload"
              type="file"
              className="sr-only"
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleFile}
            />
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-colors"
              style={{
                background: file ? "var(--violet)" : "var(--panel)",
                border: file ? "none" : "1px solid var(--line)",
              }}
            >
              {file ? <CheckCircle2 size={20} className="text-white" /> : <UploadIcon size={18} className="text-muted" />}
            </div>
            {file ? (
              <>
                <div className="text-[14px] text-text font-medium max-w-[280px] truncate">{file.name}</div>
                <div className="nova-mono text-[11.5px] text-violet mt-1">
                  {formatBytes(file.size)} · ready to process
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  className="mt-3 text-[12px] text-muted underline underline-offset-2 hover:text-text transition-colors"
                >
                  Choose a different file
                </button>
              </>
            ) : (
              <>
                <div className="text-[14px] text-text">
                  <span className="text-violet">Click to upload</span> or drag and drop
                </div>
                <div className="flex items-center gap-1.5 mt-2.5 flex-wrap justify-center">
                  {ACCEPTED_TYPES.map((t) => (
                    <span
                      key={t}
                      className="nova-mono text-[10px] text-muted px-1.5 py-0.5 rounded-md border border-line uppercase"
                    >
                      {t.replace(".", "")}
                    </span>
                  ))}
                  <span className="text-[11px] text-muted ml-1">up to 500MB</span>
                </div>
              </>
            )}
          </label>

          {visualSource === "generate" && (
            <div className="nova-card rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Palette size={13} className="text-coral" />
                <span className="nova-mono text-[11px] text-muted uppercase tracking-[0.1em]">Visual style</span>
              </div>
              <div className="flex flex-col gap-2.5">
                <input
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  placeholder="Mood or vibe (e.g. moody, upbeat, cinematic)"
                  aria-label="Mood or vibe"
                  className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] transition-colors focus:border-violet/60 focus:ring-2 focus:ring-violet/15"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    placeholder="Genre (optional)"
                    aria-label="Genre"
                    className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] transition-colors focus:border-violet/60 focus:ring-2 focus:ring-violet/15"
                  />
                  <input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="Color palette (optional)"
                    aria-label="Color palette"
                    className="w-full rounded-xl px-4 py-3 nova-root outline-none bg-panel border border-line text-text text-[13.5px] transition-colors focus:border-violet/60 focus:ring-2 focus:ring-violet/15"
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl px-3.5 py-3 mb-4 bg-coral/10 border border-coral/20">
              <AlertCircle size={15} className="text-coral shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-coral leading-snug">{error}</p>
            </div>
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

          <p className="flex items-center justify-center gap-1.5 mt-4 text-[12px] text-muted">
            <ShieldCheck size={12} className="text-muted shrink-0" />
            Private by default — nothing is posted without you.
          </p>
        </div>
      )}
    </div>
  );
}
