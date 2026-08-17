"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Wand2, X } from "lucide-react";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { DownloadLink } from "@/components/ui/DownloadLink";
import { GhostButton } from "@/components/ui/Button";
import { HOOK_LABELS, PLATFORMS } from "@/lib/design-tokens";
import type { Clip } from "@/lib/database.types";
import type { ClipGroup } from "@/components/screens/ReviewView";

function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // group.clips[0] is always one of the four platforms sharing the vertical
  // render (tiktok/shorts/reels/facebook are inserted before pinterest in
  // runTransformPhase) — same file the old ResultsView linked to for preview.
  const status = group.rejectedAt ? "Hidden" : group.approvedAt ? "Approved" : "Pending review";

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
            <button onClick={() => setEditing(true)} aria-label="Edit title" className="text-muted hover:text-text transition-colors">
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

        {error && <p className="text-[11.5px] text-ruby">{error}</p>}

        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={approve}
            disabled={busy}
            aria-label="Approve"
            aria-pressed={!!group.approvedAt}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
            style={{
              background: group.approvedAt ? "var(--text)" : "transparent",
              border: `1px solid ${group.approvedAt ? "var(--text)" : "var(--line)"}`,
            }}
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin text-muted" />
            ) : (
              <Check size={13} className={group.approvedAt ? "text-ink" : "text-muted"} />
            )}
          </button>
          <button
            onClick={reject}
            disabled={busy}
            aria-label="Reject"
            aria-pressed={!!group.rejectedAt}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
            style={{
              background: group.rejectedAt ? "var(--ruby)" : "transparent",
              border: `1px solid ${group.rejectedAt ? "var(--ruby)" : "var(--line)"}`,
            }}
          >
            <X size={13} className={group.rejectedAt ? "text-white" : "text-muted"} />
          </button>
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
