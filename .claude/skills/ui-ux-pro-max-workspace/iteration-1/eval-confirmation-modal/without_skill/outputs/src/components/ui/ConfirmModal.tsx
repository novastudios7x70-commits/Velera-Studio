"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";
import { DangerButton, GhostButton } from "@/components/ui/Button";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Generic destructive-action confirmation modal. Deliberately not tied to
// "delete a project" — any call site that needs a confirm-before-you-do-this
// step (remove a brand asset, cancel a job, etc.) can reuse this.
export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);

    // Lock background scroll while the modal is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="nova-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
        className="nova-modal-panel nova-card rounded-2xl px-6 py-6 w-full max-w-sm"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-violet-soft">
          <AlertTriangle size={17} className="text-coral" />
        </div>
        <h2 id="confirm-modal-title" className="nova-display font-semibold text-[16px] text-text mb-1.5">
          {title}
        </h2>
        <p id="confirm-modal-description" className="text-[13.5px] text-muted leading-relaxed mb-6">
          {description}
        </p>
        <div className="flex items-center justify-end gap-2.5">
          <GhostButton onClick={onCancel} disabled={loading} className="px-4 py-2.5 text-[13.5px]">
            {cancelLabel}
          </GhostButton>
          <DangerButton ref={confirmRef} onClick={onConfirm} disabled={loading} className="px-4 py-2.5 text-[13.5px]">
            {loading ? "Deleting…" : confirmLabel}
          </DangerButton>
        </div>
      </div>
    </div>
  );
}
