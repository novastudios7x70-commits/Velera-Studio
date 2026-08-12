import type { SelectedSegment } from "@/lib/database.types";

/**
 * Static, hook_type-derived "why Velora picked this" copy — an honest
 * interim for Discover's launch: it's grounded in a real property of the
 * real segment (the hook_type Claude already classified it as in
 * selectSegments.ts), just not a bespoke sentence generated per moment yet.
 * That's commit 2 (a real Claude call over each segment's transcript
 * excerpt) — this function is what it replaces, not a permanent fixture.
 */
const STATIC_WHY: Record<string, string> = {
  surprising_claim: "Opens with a claim that's likely to stop a scroll.",
  question: "Poses a question that pulls people in.",
  contrarian: "Pushes back on a common assumption.",
  result_number: "Leads with a concrete, specific result.",
  emotional: "Has an emotional beat that's likely to land.",
  chorus: "The hook of the track — the part people remember.",
  bridge: "A shift in the track worth building a clip around.",
};

export function whyForSegment(segment: Pick<SelectedSegment, "hook_type">): string {
  return STATIC_WHY[segment.hook_type] ?? "A moment Velora flagged as worth sharing.";
}

export function formatTimestampRange(startSeconds: number, endSeconds: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  return `${fmt(startSeconds)} – ${fmt(endSeconds)}`;
}
