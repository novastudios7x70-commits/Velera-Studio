"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { ReviewMomentRow } from "@/components/ui/ReviewMomentRow";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import type { Clip, ContentType, Job, VisualSource } from "@/lib/database.types";

type JobWithUpload = Job & {
  upload: { file_name: string; content_type: ContentType; visual_source: VisualSource } | null;
};

export interface ClipGroup {
  key: string;
  title: string;
  hookType: string | null;
  durationSeconds: number;
  thumbnailUrl: string | null;
  clips: Clip[];
  approvedAt: string | null;
  rejectedAt: string | null;
}

// Same grouping key ResultsView used — 5 platform rows per moment collapse
// back into one group. All 5 rows are kept in sync by the parallel PATCH
// calls in ReviewMomentRow, so the first row's review state represents the
// whole group.
function groupClips(clips: Clip[]): ClipGroup[] {
  const map = new Map<string, ClipGroup>();
  for (const clip of clips) {
    const key = `${clip.start_time}-${clip.end_time}-${clip.title}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        title: clip.title ?? "Clip",
        hookType: clip.hook_type,
        durationSeconds: clip.duration_seconds ?? 0,
        thumbnailUrl: clip.thumbnail_url,
        clips: [],
        approvedAt: clip.approved_at,
        rejectedAt: clip.rejected_at,
      };
      map.set(key, group);
    }
    group.clips.push(clip);
  }
  return [...map.values()];
}

export function ReviewView({ job, clips }: { job: JobWithUpload; clips: Clip[] }) {
  const [allClips, setAllClips] = useState<Clip[]>(clips);
  const [showHidden, setShowHidden] = useState(false);
  const generated = job.upload?.visual_source === "generate";

  const groups = groupClips(allClips);
  const visibleGroups = groups.filter((g) => !g.rejectedAt);
  const hiddenGroups = groups.filter((g) => g.rejectedAt);

  const applyPatch = (clipIds: string[], patch: Partial<Clip>) => {
    setAllClips((prev) => prev.map((c) => (clipIds.includes(c.id) ? { ...c, ...patch } : c)));
  };

  return (
    <div className="nova-fade-in max-w-2xl mx-auto px-6 py-16 w-full">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
            {`${groups.length} clip${groups.length === 1 ? "" : "s"} ready to review`}
          </TextEffect>
          <p className="text-[13.5px] text-muted">Formatted for TikTok, Shorts, Reels, Facebook &amp; Pinterest</p>
        </div>
        <Link href="/dashboard">
          <GhostButton className="px-4 py-2.5 text-[13.5px]">
            <RefreshCw size={14} /> Back to dashboard
          </GhostButton>
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="nova-card rounded-lg px-6 py-14 text-center text-[13.5px] text-muted">
          No clips were produced for this job.
        </div>
      ) : (
        <div className="flex flex-col">
          {visibleGroups.length === 0 ? (
            <div className="nova-card rounded-lg px-6 py-14 text-center text-[13.5px] text-muted">
              Every clip here is hidden — use &quot;Show hidden&quot; below to bring one back.
            </div>
          ) : (
            visibleGroups.map((g) => (
              <ReviewMomentRow key={g.key} group={g} generated={generated} onUpdated={applyPatch} />
            ))
          )}
        </div>
      )}

      {hiddenGroups.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-text transition-colors"
          >
            {showHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showHidden ? "Hide" : "Show"} hidden ({hiddenGroups.length})
          </button>
          {showHidden && (
            <div className="flex flex-col mt-3">
              {hiddenGroups.map((g) => (
                <ReviewMomentRow key={g.key} group={g} generated={generated} onUpdated={applyPatch} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-10 rounded-lg p-5 flex items-center justify-between flex-wrap gap-4 bg-panel border border-line">
        <div className="text-[13.5px] text-text max-w-[420px]">
          Got more to post? Turn your next upload into clips in the same three steps.
        </div>
        <Link href="/upload">
          <PrimaryButton className="px-5 py-2.5 text-[13.5px]">
            Find more moments <ArrowRight size={14} />
          </PrimaryButton>
        </Link>
      </div>
    </div>
  );
}
