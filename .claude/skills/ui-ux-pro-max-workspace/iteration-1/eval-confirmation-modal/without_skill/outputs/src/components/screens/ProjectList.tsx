"use client";

import Link from "next/link";
import { useState } from "react";
import { Music, Mic, FolderOpen, Clock, Wand2, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/Toast";
import type { ContentType, VisualSource, JobStatus } from "@/lib/database.types";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  generating_visuals: "Generating visuals",
  selecting: "Selecting moments",
  cutting: "Cutting",
  captioning: "Captioning",
  done: "Done",
  failed: "Failed",
};

export interface ProjectRow {
  id: string;
  status: JobStatus;
  created_at: string;
  upload: { file_name: string; content_type: ContentType; visual_source: VisualSource } | null;
  clips: { count: number }[];
}

export function ProjectList({ initialProjects }: { initialProjects: ProjectRow[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [target, setTarget] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const handleConfirmDelete = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${target.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(json.error ?? "Could not delete project.");
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== target.id));
      showToast("Project deleted");
      setTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="nova-card rounded-2xl px-6 py-14 text-center">
        <FolderOpen size={26} className="text-muted mx-auto mb-3" />
        <div className="nova-display font-medium text-[15px] text-text mb-1">No uploads yet</div>
        <div className="text-[13px] text-muted mb-5">Your first 3 clips are on us.</div>
        <Link href="/upload">
          <span className="nova-btn-primary nova-display font-semibold rounded-xl text-white inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[13.5px] mx-auto">
            New upload
          </span>
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {projects.map((p) => (
          <div
            key={p.id}
            className="nova-card nova-card-select rounded-2xl px-5 py-4 flex items-center justify-between text-left gap-4 flex-wrap relative"
          >
            {/* "Stretched link" pattern: this anchor covers the whole card so
                the row stays clickable everywhere, while the delete button
                below sits above it (z-10) as an escape hatch. Keeps us from
                nesting a <button> inside an <a>, which is invalid HTML and
                makes click targeting unreliable. */}
            <Link
              href={p.status === "done" ? `/jobs/${p.id}/results` : `/jobs/${p.id}`}
              className="absolute inset-0 rounded-2xl"
              aria-label={`Open ${p.upload?.file_name ?? "project"}`}
            />

            <div className="flex items-center gap-3.5 pointer-events-none">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-violet-soft">
                {p.upload?.content_type === "music" ? (
                  <Music size={16} className="text-violet" />
                ) : (
                  <Mic size={16} className="text-coral" />
                )}
              </div>
              <div>
                <div className="text-[14px] text-text">{p.upload?.file_name ?? "Untitled upload"}</div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-muted">
                  <Clock size={11} /> {timeAgo(p.created_at)}
                  {p.upload?.visual_source === "generate" && (
                    <span className="nova-mono ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-violet-soft text-violet flex items-center gap-1">
                      <Wand2 size={9} /> generated visuals
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 relative z-10">
              <div className="flex items-center gap-1.5 nova-mono text-[12.5px] text-muted pointer-events-none">
                {p.status === "done" ? (
                  <>
                    <FolderOpen size={13} /> {p.clips?.[0]?.count ?? 0} clips
                  </>
                ) : p.status === "failed" ? (
                  <span className="text-coral">Failed</span>
                ) : (
                  STATUS_LABEL[p.status]
                )}
              </div>
              <button
                type="button"
                onClick={() => setTarget(p)}
                aria-label={`Delete ${p.upload?.file_name ?? "project"}`}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted transition-colors hover:text-coral hover:bg-coral/10"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={target !== null}
        title="Delete this project?"
        description={
          target
            ? `"${target.upload?.file_name ?? "This project"}" and ${
                target.status === "done" ? `its ${target.clips?.[0]?.count ?? 0} clip${(target.clips?.[0]?.count ?? 0) === 1 ? "" : "s"}` : "any in-progress work"
              } will be permanently deleted. This can't be undone.`
            : ""
        }
        confirmLabel="Delete project"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setTarget(null)}
      />
    </>
  );
}
