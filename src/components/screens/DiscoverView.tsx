"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { DiscoverMomentCard } from "@/components/ui/DiscoverMomentCard";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { AnimatedGroup } from "@/components/ui/motion-primitives/animated-group";
import type { Job, ContentType, VisualSource, AudioSource } from "@/lib/database.types";

type JobWithUpload = Job & {
  upload: { file_name: string; content_type: ContentType; visual_source: VisualSource; audio_source: AudioSource } | null;
};

export function DiscoverView({ job }: { job: JobWithUpload }) {
  const router = useRouter();
  const segments = job.selected_segments ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const confirm = async (indices: number[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/confirm-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      router.push(`/jobs/${job.id}`);
    } catch {
      setError("Something went wrong — please try again.");
      setSubmitting(false);
    }
  };

  const letVeloraChoose = () => confirm(segments.map((_, i) => i));
  const confirmManualSelection = () => confirm([...selected]);

  return (
    <>
      <div className="nova-fade-in max-w-2xl mx-auto px-6 py-14 w-full pb-32">
        <div className="mb-8">
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1.5 text-[22px] text-text">
            {`${segments.length} moment${segments.length === 1 ? "" : "s"} worth watching`}
          </TextEffect>
          <p className="text-[13.5px] text-muted">
            Velora went through {job.upload?.file_name ?? "your upload"} and found these. Pick the ones you want, or let it decide.
          </p>
        </div>

        <AnimatedGroup preset="fade" className="flex flex-col">
          {segments.map((segment, i) => (
            <DiscoverMomentCard key={i} segment={segment} index={i} selected={selected.has(i)} onToggle={() => toggle(i)} />
          ))}
        </AnimatedGroup>

        {error && <p className="text-[12.5px] text-ruby mt-4">{error}</p>}

        <div className="mt-8">
          <GhostButton onClick={letVeloraChoose} disabled={submitting} className="px-4 py-2.5 text-[13px]">
            Let Velora choose for me
          </GhostButton>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-line bg-void">
          <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <span className="text-[13px] text-muted">
              {selected.size} moment{selected.size === 1 ? "" : "s"} selected
            </span>
            <PrimaryButton onClick={confirmManualSelection} disabled={submitting} className="px-5 py-2.5 text-[13.5px]">
              {submitting ? "Starting…" : "Create selected clips"} <ArrowRight size={14} />
            </PrimaryButton>
          </div>
        </div>
      )}
    </>
  );
}
