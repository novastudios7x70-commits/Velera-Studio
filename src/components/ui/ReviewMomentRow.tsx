"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Scissors, Wand2, X } from "lucide-react";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { DownloadLink } from "@/components/ui/DownloadLink";
import { GhostButton, PrimaryButton } from "@/components/ui/Button";
import { HOOK_LABELS, PLATFORMS } from "@/lib/design-tokens";
import type { Clip } from "@/lib/database.types";
import type { ClipGroup } from "@/components/screens/ReviewView";

// Mirrors worker/src/pipeline/selectSegments.ts's MIN_CLIP_SECONDS/
// MAX_CLIP_SECONDS and worker/src/jobRunner.ts's GENERATED_VISUAL_MAX_SECONDS
// (also already duplicated once in the re-render route for the same
// reason) — src/ never imports across the worker/ package boundary.
const MIN_CLIP_SECONDS = 12;
const MAX_CLIP_SECONDS = 45;
const GENERATED_VISUAL_MAX_SECONDS = 45;
// How long a reclip can sit at render_started_at before Review says
// something about it. Purely informational — see saveTrim/the render below;
// nothing here cancels, resets, or retries the render.
const STUCK_THRESHOLD_MS = 90_000;

function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Moment-level actions update all 5 platform rows in parallel — Commit 1's
// PATCH /api/clips/[id] stays single-clip; there's no new multi-clip route.
// Promise.allSettled (not Promise.all) so a partial failure doesn't discard
// the rows that did succeed or get silently treated as a full success.
async function patchGroup(clipIds: string[], body: { action: string; title?: string }): Promise<string[]> {
  const results = await Promise.allSettled(
    clipIds.map(async (id) => {
      const res = await fetch(`/api/clips/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      return id;
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);
}

export function ReviewMomentRow({
  group,
  generated,
  onUpdated,
}: {
  group: ClipGroup;
  generated: boolean;
  onUpdated: (clipIds: string[], patch: Partial<Clip>) => void;
}) {
  const clipIds = group.clips.map((c) => c.id);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(group.title);
  const [trimming, setTrimming] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const [endDraft, setEndDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRendering = !!group.renderStartedAt;
  // Only meaningful once rendering has actually cleared — a fresh attempt
  // always clears render_failed_at the moment it starts (the re-render
  // route's claim update), so these two are never both true.
  const failed = !!group.renderFailedAt && !isRendering;

  const rawStart = group.clips[0]?.start_time ?? null;
  const rawEnd = group.clips[0]?.end_time ?? null;
  const currentStartSec = rawStart !== null ? Number(rawStart) : NaN;
  const currentEndSec = rawEnd !== null ? Number(rawEnd) : NaN;
  const hasValidBounds = Number.isFinite(currentStartSec) && Number.isFinite(currentEndSec);

  // Ticks while rendering so the "taking longer than expected" check
  // re-evaluates live instead of only on the next unrelated re-render.
  // Inert (no interval) the moment rendering isn't in progress.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRendering) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [isRendering]);
  const stuck = isRendering && group.renderStartedAt
    ? now - new Date(group.renderStartedAt).getTime() > STUCK_THRESHOLD_MS
    : false;

  const runAction = async (body: { action: string; title?: string }, patch: Partial<Clip>) => {
    setBusy(true);
    setError(null);
    const succeeded = await patchGroup(clipIds, body);
    if (succeeded.length > 0) onUpdated(succeeded, patch);
    if (succeeded.length < clipIds.length) {
      setError(succeeded.length === 0 ? "Couldn't update — try again." : "Some platforms didn't update — try again.");
    }
    setBusy(false);
  };

  const approve = () => runAction({ action: "approve" }, { approved_at: new Date().toISOString(), rejected_at: null });
  const reject = () => runAction({ action: "reject" }, { rejected_at: new Date().toISOString(), approved_at: null });

  const saveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === group.title) {
      setEditing(false);
      setTitleDraft(group.title);
      return;
    }
    await runAction({ action: "edit_title", title: trimmed }, { title: trimmed, approved_at: null, rejected_at: null });
    setEditing(false);
  };

  const startTrimEdit = () => {
    setStartDraft(formatDuration(currentStartSec));
    setEndDraft(formatDuration(currentEndSec));
    setError(null);
    setTrimming(true);
  };

  const saveTrim = async () => {
    const start = parseTimestamp(startDraft);
    const end = parseTimestamp(endDraft);
    if (start === null || end === null) {
      setError("Enter times as m:ss.");
      return;
    }
    if (start < 0 || end <= start) {
      setError("End must be after start.");
      return;
    }
    const duration = end - start;
    if (duration < MIN_CLIP_SECONDS || duration > MAX_CLIP_SECONDS) {
      setError(`Clips must be between ${MIN_CLIP_SECONDS} and ${MAX_CLIP_SECONDS} seconds long.`);
      return;
    }
    if (generated && end > GENERATED_VISUAL_MAX_SECONDS) {
      setError(`Generated-visual clips can't extend past ${formatDuration(GENERATED_VISUAL_MAX_SECONDS)}.`);
      return;
    }
    if (start === currentStartSec && end === currentEndSec) {
      setError("Adjust the start or end before re-rendering.");
      return;
    }

    setBusy(true);
    setError(null);
    setTrimming(false);
    // Optimistic — the server has already committed render_started_at by
    // the time its response comes back, so this can only ever be confirmed,
    // never contradicted, by the Realtime/poll update that follows.
    onUpdated(clipIds, { render_started_at: new Date().toISOString(), render_failed_at: null });

    try {
      const res = await fetch(`/api/clips/${clipIds[0]}/re-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSec: start, endSec: end }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        onUpdated(clipIds, { render_started_at: null });
        setError(body?.error ?? "Couldn't start re-render — try again.");
      }
    } catch {
      onUpdated(clipIds, { render_started_at: null });
      setError("Couldn't start re-render — try again.");
    }
    setBusy(false);
  };

  // group.clips[0] is always one of the four platforms sharing the vertical
  // render (tiktok/shorts/reels/facebook are inserted before pinterest in
  // runTransformPhase) — same file the old ResultsView linked to for preview.
  const status = group.rejectedAt ? "Hidden" : group.approvedAt ? "Approved" : "Pending review";
  const displayError = error ?? (failed ? "Re-render failed — the original clip is unchanged." : null);

  return (
    <div className="flex gap-4 py-5 border-b border-line last:border-b-0">
      <div className="w-[130px] shrink-0">
        <VideoPlayer src={group.clips[0]?.file_url} poster={group.thumbnailUrl} className="w-full aspect-[9/16]" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={140}
              autoFocus
              aria-label="Edit title"
              className="flex-1 rounded-lg px-3 py-1.5 nova-root outline-none bg-panel border border-line text-text text-[13.5px]"
            />
            <GhostButton onClick={saveTitle} disabled={busy} className="px-3 py-1.5 text-[12px]">
              Save
            </GhostButton>
            <GhostButton
              onClick={() => {
                setEditing(false);
                setTitleDraft(group.title);
              }}
              disabled={busy}
              className="px-3 py-1.5 text-[12px]"
            >
              Cancel
            </GhostButton>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="text-[14.5px] text-text leading-snug">{group.title}</div>
            <button
              onClick={() => setEditing(true)}
              disabled={busy || isRendering}
              aria-label="Edit title"
              className="text-muted hover:text-text transition-colors disabled:opacity-40 disabled:hover:text-muted"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <span className="nova-mono px-2 py-0.5 rounded-full text-[10px] bg-elevated text-muted border border-line">
            {(group.hookType && HOOK_LABELS[group.hookType]) || group.hookType}
          </span>
          <span className="nova-mono text-[10px] text-muted">{formatDuration(group.durationSeconds)}</span>
          {generated && (
            <span className="nova-mono px-2 py-0.5 rounded-full text-[10px] bg-elevated text-muted border border-line flex items-center gap-1">
              <Wand2 size={9} /> generated
            </span>
          )}
          <span
            className="nova-mono px-2 py-0.5 rounded-full text-[10px] border border-line"
            style={{
              color: status === "Approved" ? "var(--text)" : "var(--muted)",
              background: status === "Approved" ? "var(--elevated)" : "transparent",
            }}
          >
            {status}
          </span>
        </div>

        {hasValidBounds && (
          <div>
            {isRendering ? (
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--gold)" }}>
                  <Loader2 size={12} className="animate-spin" /> Re-rendering…
                </span>
                {stuck && (
                  <span className="text-[11px] text-muted">
                    This is taking longer than expected. Your current clip is still available.
                  </span>
                )}
              </div>
            ) : trimming ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  value={startDraft}
                  onChange={(e) => setStartDraft(e.target.value)}
                  placeholder="0:00"
                  autoFocus
                  aria-label="Start time"
                  className="w-14 rounded-lg px-2 py-1 nova-root outline-none bg-panel border border-line text-text text-[12px] text-center"
                />
                <span className="text-[11px] text-muted">to</span>
                <input
                  value={endDraft}
                  onChange={(e) => setEndDraft(e.target.value)}
                  placeholder="0:15"
                  aria-label="End time"
                  className="w-14 rounded-lg px-2 py-1 nova-root outline-none bg-panel border border-line text-text text-[12px] text-center"
                />
                <PrimaryButton onClick={saveTrim} disabled={busy} className="px-3 py-1.5 text-[12px]">
                  Save &amp; Re-render
                </PrimaryButton>
                <GhostButton onClick={() => setTrimming(false)} disabled={busy} className="px-3 py-1.5 text-[12px]">
                  Cancel
                </GhostButton>
              </div>
            ) : (
              <button
                onClick={startTrimEdit}
                disabled={busy}
                aria-label="Edit start and end time"
                className="flex items-center gap-1.5 nova-mono text-[11px] text-muted border border-line rounded-full px-2 py-0.5 transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-text disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-muted"
              >
                {formatDuration(currentStartSec)} – {formatDuration(currentEndSec)}
                <Scissors size={11} />
              </button>
            )}
          </div>
        )}

        {displayError && <p className="text-[11.5px] text-ruby">{displayError}</p>}

        <div className="flex items-center gap-2 mt-1">
          <PrimaryButton onClick={approve} disabled={busy || isRendering} className="px-3 py-1.5 text-[12px]">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {group.approvedAt ? "Approved" : "Approve"}
          </PrimaryButton>
          <GhostButton
            onClick={reject}
            disabled={busy || isRendering}
            className="px-3 py-1.5 text-[12px]"
            style={
              group.rejectedAt
                ? { color: "white", background: "var(--ruby)", borderColor: "var(--ruby)" }
                : { color: "var(--ruby)", borderColor: "var(--ruby-soft)" }
            }
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            {group.rejectedAt ? "Hidden" : "Reject"}
          </GhostButton>
        </div>

        <div className="grid grid-cols-3 gap-1.5 mt-1 max-w-[360px]">
          {group.clips.map((clip) => (
            <DownloadLink
              key={clip.id}
              clipId={clip.id}
              url={clip.file_url ?? "#"}
              label={PLATFORMS.find((p) => p.id === clip.platform)?.label ?? clip.platform}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
