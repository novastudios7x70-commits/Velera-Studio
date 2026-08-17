"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
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

  // Natural-language re-ranking (Commit 2). `matches` is the last query's
  // result — index -> "why this matches" reason — and stays in place across
  // manual toggling until a new query replaces it (only submitting a new
  // query clears/replaces it, per the approved spec). null means no query
  // is active, which is the normal Commit 1 state.
  const [query, setQuery] = useState("");
  const [queryLoading, setQueryLoading] = useState(false);
  const [matches, setMatches] = useState<Map<number, string> | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const submitQuery = async () => {
    const trimmed = query.trim();
    if (!trimmed || queryLoading) return;
    setQueryLoading(true);
    setQueryError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/discover-query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setQueryError(json.error ?? "Velora couldn't process that — please try again.");
        setMatches(null);
        setQueryLoading(false);
        return;
      }
      const results = (json.matches ?? []) as { index: number; reason: string }[];
      if (results.length === 0) {
        setQueryError("Nothing here matches that — try rephrasing, or pick moments manually.");
        setMatches(null);
        setQueryLoading(false);
        return;
      }
      const nextMatches = new Map(results.map((m) => [m.index, m.reason] as const));
      setMatches(nextMatches);
      setSelected(new Set(nextMatches.keys()));
      setQueryLoading(false);
    } catch {
      setQueryError("Velora couldn't process that — please try again.");
      setMatches(null);
      setQueryLoading(false);
    }
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
            <DiscoverMomentCard
              key={i}
              segment={segment}
              index={i}
              selected={selected.has(i)}
              onToggle={() => toggle(i)}
              matchReason={matches?.get(i)}
              dimmed={matches !== null && !matches.has(i)}
            />
          ))}
        </AnimatedGroup>

        {error && <p className="text-[12.5px] text-ruby mt-4">{error}</p>}

        <div className="mt-8 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitQuery();
              }}
              placeholder={`Tell Velora what you're going for — e.g. "the funniest moment"`}
              maxLength={300}
              disabled={queryLoading}
              aria-label="Describe what you want Velora to find"
              className="flex-1 rounded-xl px-4 py-2.5 nova-root outline-none bg-panel border border-line text-text text-[13px] disabled:opacity-60"
            />
            <GhostButton
              onClick={submitQuery}
              disabled={queryLoading || !query.trim()}
              className="px-4 py-2.5 text-[13px] shrink-0"
            >
              {queryLoading ? <Loader2 size={14} className="animate-spin" /> : "Ask Velora"}
            </GhostButton>
          </div>
          {queryError && <p className="text-[12.5px] text-ruby">{queryError}</p>}

          <GhostButton onClick={letVeloraChoose} disabled={submitting} className="px-4 py-2.5 text-[13px] self-start">
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
