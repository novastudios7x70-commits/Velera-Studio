import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/server";
import { logOutAction } from "@/lib/auth-actions";
import { LogOut } from "lucide-react";
import { NotificationBell, type JobNotification } from "@/components/NotificationBell";
import { isWithinLast } from "@/lib/format";

// How many completed/failed jobs to surface in the notification dropdown.
const NOTIFICATION_LIMIT = 8;
// A completion counts toward the badge if it landed in the last 24h. There's
// no per-user read/seen state in the schema yet, so this recency window
// stands in for "unread" rather than adding a notifications table just for
// this bell.
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function SiteHeader({ demoMode = false }: { demoMode?: boolean }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let notifications: JobNotification[] = [];
  if (user) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, status, updated_at, upload:uploads(file_name)")
      .in("status", ["done", "failed"])
      .order("updated_at", { ascending: false })
      .limit(NOTIFICATION_LIMIT)
      .returns<{ id: string; status: "done" | "failed"; updated_at: string; upload: { file_name: string } | null }[]>();

    notifications = (jobs ?? []).map((j) => ({
      id: j.id,
      status: j.status,
      updatedAt: j.updated_at,
      fileName: j.upload?.file_name ?? "Untitled upload",
    }));
  }

  const newNotificationCount = notifications.filter((n) => isWithinLast(n.updatedAt, NEW_WINDOW_MS)).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
      <Logo />
      <div className="flex items-center gap-3">
        {demoMode && (
          <div className="nova-mono px-2.5 py-1 rounded-full text-[10.5px] text-muted border border-line">
            demo mode
          </div>
        )}
        {user && <NotificationBell notifications={notifications} newCount={newNotificationCount} />}
        {user ? (
          <form action={logOutAction}>
            <button
              type="submit"
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-line text-muted text-[13.5px] hover:text-text transition-colors"
            >
              <LogOut size={14} /> Log out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="nova-display font-medium px-4 py-2 rounded-lg text-text text-[13.5px] border border-line"
          >
            Log in
          </Link>
        )}
      </div>
    </div>
  );
}
