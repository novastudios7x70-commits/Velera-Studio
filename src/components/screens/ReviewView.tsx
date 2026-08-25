"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArrowRight, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { ReviewMomentRow } from "@/components/ui/ReviewMomentRow";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { createClient } from "@/lib/supabase/client";
import { downloadClipsAsZip } from "@/lib/downloadZip";
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
  renderStartedAt: string | null;
  renderFailedAt: string | null;
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
        renderStartedAt: clip.render_started_at,
        renderFailedAt: clip.render_failed_at,
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
  const downloadableClips = visibleGroups.flatMap((g) => g.clips);

  const applyPatch = (clipIds: string[], patch: Partial<Clip>) => {
    setAllClips((prev) => prev.map((c) => (clipIds.includes(c.id) ? { ...c, ...patch } : c)));
  };

  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  // zipBusy (state) drives the UI; this ref is the actual re-entrancy guard.
  // State updates aren't synchronous/immediate across separate event
  // handler invocations that fire before React re-renders (e.g. a rapid
  // double-click), so checking zipBusy alone can race — a ref mutates the
  // instant it's set, closing that window.
  const zipBusyRef = useRef(false);

  const handleDownloadAll = async () => {
    if (zipBusyRef.current) return;
    zipBusyRef.current = true;
    setZipBusy(true);
    setZipError(null);
    try {
      await downloadClipsAsZip(downloadableClips);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : "Couldn't create the ZIP — try again.");
    }
    zipBusyRef.current = false;
    setZipBusy(false);
  };

  // Live updates for reclip in-flight/completion — a reclip is enqueued by
  // an API route this page never calls directly, so nothing else refreshes
  // this data. Mirrors ProcessingView's own Realtime + polling pattern: the
  // channel stays subscribed for the page's lifetime, and payload.new is a
  // full row (postgrest always sends the complete post-image on UPDATE), so
  // merging it in directly is safe and matches what ProcessingView already
  // relies on for jobs.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`review-clips-${job.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clips", filter: `job_id=eq.${job.id}` },
        (payload) => {
          const newRow = payload.new as Clip;
          setAllClips((prev) => prev.map((c) => (c.id === newRow.id ? newRow : c)));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.id]);

  // Backstop, same reasoning as ProcessingView's: Realtime can silently miss
  // an event or drop the connection. Only active while something is
  // actually in flight, so it costs nothing once every reclip has settled.
  const anyRendering = allClips.some((c) => c.render_started_at);
  useEffect(() => {
    if (!anyRendering) return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase.from("clips").select("*").eq("job_id", job.id);
      if (data) setAllClips(data);
    }, 6000);
    return () => clearInterval(interval);
  }, [job.id, anyRendering]);

  return (
    <div className="nova-fade-in max-w-2xl mx-auto px-6 py-16 w-full">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
            {`${groups.length} clip${groups.length === 1 ? "" : "s"} ready to review`}
          </TextEffect>
          <p className="text-[13.5px] text-muted">Formatted for TikTok, Shorts, Reels, Facebook &amp; Pinterest</p>
        </div>
        <div className="flex items-center gap-2.5">
          <GhostButton
            onClick={handleDownloadAll}
            disabled={zipBusy || downloadableClips.length === 0}
            className="px-4 py-2.5 text-[13.5px]"
          >
            {zipBusy ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
            {zipBusy ? "Preparing ZIP…" : "Download all"}
          </GhostButton>
          <Link href="/dashboard">
            <GhostButton className="px-4 py-2.5 text-[13.5px]">
              <RefreshCw size={14} /> Back to dashboard
            </GhostButton>
          </Link>
        </div>
      </div>

      {zipError && (
        <p className="text-[12.5px] text-ruby mb-6 -mt-4">
          {zipError} Individual downloads are still available below.
        </p>
      )}

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
