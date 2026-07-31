"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { GhostButton, PrimaryButton, DangerButton } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Coral/danger styling for destructive actions (delete, remove, cancel-with-loss). */
  danger?: boolean;
  /** Disables both buttons and swaps the confirm label while an action is in flight. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Shared confirmation modal for any destructive or hard-to-undo action.
// Reuse this rather than a one-off `confirm()` or a bespoke dialog per screen.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading]);

  if (!open) return null;

  const ConfirmButton = danger ? DangerButton : PrimaryButton;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="nova-fade-in absolute inset-0 bg-void/80 backdrop-blur-sm"
        style={{ animationDuration: "0.2s" }}
        onClick={loading ? undefined : onCancel}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="nova-card nova-fade-in relative w-full max-w-sm rounded-2xl p-6"
        style={{ animationDuration: "0.25s" }}
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
            danger ? "bg-coral/15" : "bg-violet-soft"
          }`}
        >
          <AlertTriangle size={17} className={danger ? "text-coral" : "text-violet"} />
        </div>

        <h2 id="confirm-dialog-title" className="nova-display font-semibold text-[16px] text-text mb-1.5">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="text-[13px] text-muted leading-relaxed mb-6">
          {description}
        </p>

        <div className="flex items-center justify-end gap-2.5">
          <GhostButton onClick={onCancel} disabled={loading} className="px-4 py-2.5 text-[13px]">
            {cancelLabel}
          </GhostButton>
          <ConfirmButton autoFocus onClick={onConfirm} disabled={loading} className="px-4 py-2.5 text-[13px]">
            {loading ? "Deleting…" : confirmLabel}
          </ConfirmButton>
        </div>
      </div>
    </div>
  );
}
