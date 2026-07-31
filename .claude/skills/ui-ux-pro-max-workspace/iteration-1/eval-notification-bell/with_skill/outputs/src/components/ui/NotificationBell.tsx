"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, AlertTriangle } from "lucide-react";

export interface NotificationItem {
  id: string;
  status: "done" | "failed";
  updatedAt: string;
  fileName: string;
}

// Tracked client-side (not in the DB) so opening the dropdown doesn't need a
// write round-trip. Shared across accounts on the same browser, which is an
// acceptable trade for a first pass — a `profiles.notifications_seen_at`
// column would be the natural upgrade if that ever matters.
const SEEN_KEY = "velora:notifications:last_seen_at";

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

export function NotificationBell({ notifications }: { notifications: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reading localStorage must happen after mount (it doesn't exist during
    // SSR) — this is a one-time sync from a browser API into React state,
    // not derivable render-time state, so a direct setState here is correct.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser-only API on mount, not derivable state
    setLastSeen(localStorage.getItem(SEEN_KEY));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Avoid a hydration mismatch: unread count depends on localStorage, so it
  // reads as 0 until mounted, then reconciles.
  const unreadCount = !hydrated
    ? 0
    : lastSeen === null
      ? notifications.length
      : notifications.filter((n) => new Date(n.updatedAt).getTime() > new Date(lastSeen).getTime()).length;

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const now = new Date().toISOString();
        localStorage.setItem(SEEN_KEY, now);
        setLastSeen(now);
      }
      return next;
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-line text-muted hover:text-text hover:border-violet/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="nova-mono absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-violet text-[9.5px] font-semibold text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Recent job completions"
          className="nova-fade-in nova-card nova-scrollbar absolute right-0 top-full mt-2 w-[340px] max-h-[420px] overflow-y-auto rounded-2xl z-50"
        >
          <div className="px-4 py-3 border-b border-line">
            <div className="nova-display font-medium text-[13.5px] text-text">Notifications</div>
          </div>

          {notifications.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Bell size={20} className="text-muted mx-auto mb-2.5" />
              <div className="text-[12.5px] text-muted">Nothing yet — completed jobs will show up here.</div>
            </div>
          ) : (
            <ul className="py-1.5">
              {notifications.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.status === "done" ? `/jobs/${n.id}/results` : `/jobs/${n.id}`}
                    onClick={() => setOpen(false)}
                    role="menuitem"
                    className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:bg-white/[0.05]"
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        n.status === "done" ? "bg-violet-soft" : "bg-coral/10"
                      }`}
                    >
                      {n.status === "done" ? (
                        <CheckCircle2 size={13} className="text-violet" />
                      ) : (
                        <AlertTriangle size={13} className="text-coral" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-text truncate">{n.fileName}</div>
                      <div className="text-[12px] text-muted mt-0.5">
                        {n.status === "done" ? "Finished processing" : "Failed to process"} · {timeAgo(n.updatedAt)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
