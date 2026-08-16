"use client";

import { Check } from "lucide-react";
import { ClipThumb } from "@/components/ui/ClipThumb";
import { formatTimestampRange, whyForSegment } from "@/lib/discover";
import type { SelectedSegment } from "@/lib/database.types";

export function DiscoverMomentCard({
  segment,
  index,
  selected,
  onToggle,
  matchReason,
  dimmed,
}: {
  segment: SelectedSegment;
  index: number;
  selected: boolean;
  onToggle: () => void;
  // Set when a natural-language query is active: matchReason (present only
  // on matched moments) replaces the normal discovery-time why-text rather
  // than stacking alongside it; dimmed marks moments the query didn't match
  // — visually de-emphasized only, never hidden or made unselectable.
  matchReason?: string;
  dimmed?: boolean;
}) {
  return (
    <div className={`flex gap-4 py-5 border-b border-line last:border-b-0 transition-opacity ${dimmed ? "opacity-50" : ""}`}>
      <div className="w-[100px] shrink-0">
        <ClipThumb seed={index} thumbnailUrl={segment.thumbnail_url} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <div className="text-[14.5px] text-text leading-snug">{segment.suggested_caption}</div>
        <div className="nova-mono text-[11.5px] text-muted">
          {formatTimestampRange(segment.start_time, segment.end_time)}
        </div>
        <div className="text-[12.5px] text-muted leading-relaxed mt-0.5 max-w-[440px]">
          {matchReason ?? whyForSegment(segment)}
        </div>
      </div>

      <button
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? "Deselect this moment" : "Select this moment"}
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 self-start mt-1 transition-colors"
        style={{
          background: selected ? "var(--text)" : "transparent",
          border: `1px solid ${selected ? "var(--text)" : "var(--line)"}`,
        }}
      >
        {selected && <Check size={14} className="text-ink" />}
      </button>
    </div>
  );
}
