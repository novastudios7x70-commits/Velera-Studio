"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, AlertTriangle, Inbox } from "lucide-react";
import { timeAgo } from "@/lib/format";

export interface JobNotification {
  id: string;
  fileName: string;
  status: "done" | "failed";
  updatedAt: string;
}

export function NotificationBell({
  notifications,
  newCount,
}: {
  notifications: JobNotification[];
  /**
   * Count of completions considered "new" for the badge. Computed on the
   * server (see SiteHeader) rather than by comparing Date.now() against
   * updatedAt in here, since a component render must stay pure — reading
   * the clock during render would make the badge non-deterministic and
   * (harmlessly but needlessly) drift from the server's clock.
   */
  newCount: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={newCount > 0 ? `Notifications, ${newCount} new` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-line text-muted hover:text-text hover:border-violet/50 transition-colors"
      >
        <Bell size={15} />
        {newCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-violet text-[9.5px] nova-mono font-medium text-void flex items-center justify-center leading-none">
            {newCount > 9 ? "9+" : newCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="nova-fade-in absolute right-0 top-[calc(100%+10px)] w-[320px] max-h-[420px] overflow-y-auto nova-scrollbar nova-card rounded-2xl py-2 z-50"
        >
          <div className="px-4 py-2 nova-mono text-[10.5px] uppercase tracking-wide text-muted">
            Recent activity
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 flex flex-col items-center text-center gap-2">
              <Inbox size={20} className="text-muted" />
              <div className="text-[12.5px] text-muted">
                You&rsquo;ll see job updates here once a clip finishes processing.
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((n) => {
                const isDone = n.status === "done";
                return (
                  <Link
                    key={n.id}
                    href={isDone ? `/jobs/${n.id}/results` : `/jobs/${n.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
                  >
                    <div
                      className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isDone ? "bg-violet-soft" : "bg-coral/10"
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 size={14} className="text-violet" />
                      ) : (
                        <AlertTriangle size={14} className="text-coral" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-text truncate">
                        {n.fileName}{" "}
                        <span className="text-muted font-normal">
                          {isDone ? "finished processing" : "failed to process"}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5">{timeAgo(n.updatedAt)}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="mt-1 pt-2 px-4 border-t border-line">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="block text-[12px] text-violet py-1.5"
            >
              View all projects
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
