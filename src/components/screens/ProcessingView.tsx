"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { StepPill } from "@/components/ui/StepPill";
import { GhostButton } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import type { ContentType, Job, JobStatus, VisualSource } from "@/lib/database.types";

type JobWithUpload = Job & {
  upload: { file_name: string; content_type: ContentType; visual_source: VisualSource } | null;
};

function stepsFor(contentType: ContentType, visualSource: VisualSource): { status: JobStatus; label: string }[] {
  const steps: { status: JobStatus; label: string }[] = [
    { status: "analyzing", label: contentType === "spoken" ? "Transcribing audio" : "Analyzing energy & mood" },
  ];
  if (visualSource === "generate") {
    steps.push({ status: "generating_visuals", label: "Generating matching visuals" });
  }
  steps.push(
    { status: "selecting", label: "Finding hook-worthy moments" },
    { status: "cutting", label: "Cutting clips" },
    { status: "captioning", label: "Styling captions" },
  );
  return steps;
}

const STATUS_ORDER: JobStatus[] = [
  "queued", "analyzing", "generating_visuals", "selecting", "cutting", "captioning", "done",
];

export function ProcessingView({ initialJob }: { initialJob: JobWithUpload }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`job-${initialJob.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${initialJob.id}` },
        (payload) => {
          setJob((prev) => ({ ...prev, ...(payload.new as Job) }));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialJob.id]);

  useEffect(() => {
    if (job.status === "done") router.replace(`/jobs/${job.id}/results`);
  }, [job.status, job.id, router]);

  if (!job.upload) return null;

  if (job.status === "failed") {
    return (
      <div className="nova-fade-in max-w-md mx-auto px-6 py-24 text-center w-full">
        <div className="mx-auto mb-7 w-16 h-16 rounded-2xl flex items-center justify-center bg-coral/10">
          <AlertTriangle size={26} className="text-coral" />
        </div>
        <h1 className="nova-display font-semibold mb-1 text-[20px] text-text">Something went wrong</h1>
        <p className="mb-6 text-[13.5px] text-muted">
          {job.error_message ?? "This upload couldn't be processed. Your clip credit has been refunded."}
        </p>
        <GhostButton onClick={() => router.push("/upload")} className="px-5 py-2.5 text-[13.5px] mx-auto">
          Try another upload
        </GhostButton>
      </div>
    );
  }

  const steps = stepsFor(job.upload.content_type, job.upload.visual_source);
  const currentIdx = STATUS_ORDER.indexOf(job.status);
  const pct = Math.min(100, Math.round(((currentIdx + 1) / (STATUS_ORDER.length - 1)) * 100));

  return (
    <div className="nova-fade-in max-w-md mx-auto px-6 py-24 text-center w-full">
      <div className="mx-auto mb-7 w-16 h-16 rounded-2xl flex items-center justify-center bg-violet-soft">
        <Loader2 size={26} className="text-violet animate-spin" />
      </div>
      <h1 className="nova-display font-semibold mb-1 text-[20px] text-text">Building your clips</h1>
      <p className="mb-8 text-[13.5px] text-muted">{job.upload.file_name}</p>

      <div className="rounded-full h-1.5 mb-8 overflow-hidden bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--violet), var(--coral))" }}
        />
      </div>

      <div className="flex flex-col gap-3 text-left">
        {steps.map((s, i) => (
          <StepPill
            key={s.status}
            n={i + 1}
            label={s.label}
            active={s.status === job.status}
            done={STATUS_ORDER.indexOf(s.status) < currentIdx}
          />
        ))}
        <StepPill
          n={steps.length + 1}
          label="Formatting for TikTok, Shorts, Reels, Facebook & Pinterest"
          active={false}
          done={job.status === "done"}
        />
      </div>
    </div>
  );
}
