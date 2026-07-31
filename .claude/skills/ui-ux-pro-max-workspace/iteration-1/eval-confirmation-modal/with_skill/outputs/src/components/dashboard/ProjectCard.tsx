"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Music, Mic, FolderOpen, Clock, Wand2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { timeAgo } from "@/lib/time";
import type { ContentType, JobStatus, VisualSource } from "@/lib/database.types";

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

interface ProjectCardProps {
  id: string;
  status: JobStatus;
  createdAt: string;
  fileName: string;
  contentType: ContentType | null;
  visualSource: VisualSource | null;
  clipCount: number;
}

export function ProjectCard({ id, status, createdAt, fileName, contentType, visualSource, clipCount }: ProjectCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setConfirmOpen(false);
      showToast("Project deleted");
      router.refresh();
    } catch {
      setDeleting(false);
      showToast("Couldn't delete this project — try again");
    }
  };

  return (
    <>
      <div className="nova-card nova-card-select rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <Link
          href={status === "done" ? `/jobs/${id}/results` : `/jobs/${id}`}
          className="flex items-center gap-3.5 min-w-0 flex-1"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-violet-soft">
            {contentType === "music" ? <Music size={16} className="text-violet" /> : <Mic size={16} className="text-coral" />}
          </div>
          <div className="min-w-0">
            <div className="text-[14px] text-text truncate">{fileName}</div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-muted flex-wrap">
              <Clock size={11} /> {timeAgo(createdAt)}
              {visualSource === "generate" && (
                <span className="nova-mono ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-violet-soft text-violet flex items-center gap-1">
                  <Wand2 size={9} /> generated visuals
                </span>
              )}
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 nova-mono text-[12.5px] text-muted">
            {status === "done" ? (
              <>
                <FolderOpen size={13} /> {clipCount} clips
              </>
            ) : status === "failed" ? (
              <span className="text-coral">Failed</span>
            ) : (
              STATUS_LABEL[status]
            )}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            aria-label={`Delete "${fileName}"`}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-muted transition-colors hover:text-coral hover:bg-coral/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this project?"
        description={`"${fileName}" and its ${clipCount || ""} clips will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete project"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
