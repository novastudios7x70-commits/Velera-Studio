import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/server";
import { logOutAction } from "@/lib/auth-actions";
import { LogOut } from "lucide-react";
import { NotificationBell, type NotificationItem } from "@/components/ui/NotificationBell";

interface RecentJobRow {
  id: string;
  status: "done" | "failed";
  updated_at: string;
  upload: { file_name: string } | null;
}

export async function SiteHeader({ demoMode = false }: { demoMode?: boolean }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Recently-finished jobs power the notification bell — "recent" here means
  // the last 20 done/failed jobs, newest first. RLS scopes this to the
  // logged-in user's own rows, same as every other jobs query in the app.
  let notifications: NotificationItem[] = [];
  if (user) {
    const { data: recentJobs } = await supabase
      .from("jobs")
      .select("id, status, updated_at, upload:uploads(file_name)")
      .in("status", ["done", "failed"])
      .order("updated_at", { ascending: false })
      .limit(20)
      .returns<RecentJobRow[]>();

    notifications = (recentJobs ?? []).map((job) => ({
      id: job.id,
      status: job.status,
      updatedAt: job.updated_at,
      fileName: job.upload?.file_name ?? "Untitled upload",
    }));
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
      <Logo />
      <div className="flex items-center gap-3">
        {demoMode && (
          <div className="nova-mono px-2.5 py-1 rounded-full text-[10.5px] text-muted border border-line">
            demo mode
          </div>
        )}
        {user ? (
          <>
            <NotificationBell notifications={notifications} />
            <form action={logOutAction}>
              <button
                type="submit"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-line text-muted text-[13.5px] hover:text-text transition-colors"
              >
                <LogOut size={14} /> Log out
              </button>
            </form>
          </>
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
