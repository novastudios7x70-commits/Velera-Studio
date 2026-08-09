import Link from "next/link";
import { redirect } from "next/navigation";
import { Music, Mic, Plus, FolderOpen, Clock, Wand2, Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import type { ContentType, VisualSource, JobStatus } from "@/lib/database.types";

// streak_count only advances/resets inside create_job() when a new upload
// happens, so a profile that's gone quiet still shows its old count until
// the next job. Compute what the streak actually looks like right now —
// still alive (active today or yesterday) or already lapsed — rather than
// trusting the stored number as-is.
function currentStreak(streakCount: number, lastActiveDate: string | null): number {
  if (!lastActiveDate) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (lastActiveDate === today || lastActiveDate === yesterday) return streakCount;
  return 0;
}

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
  generating_voiceover: "Generating voiceover",
  analyzing: "Analyzing",
  generating_visuals: "Generating visuals",
  selecting: "Selecting moments",
  cutting: "Cutting",
  captioning: "Captioning",
  done: "Done",
  failed: "Failed",
};

interface ProjectRow {
  id: string;
  status: JobStatus;
  created_at: string;
  upload: { file_name: string; content_type: ContentType; visual_source: VisualSource } | null;
  clips: { count: number }[];
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Run sequentially rather than via Promise.all — combining a plain
  // .single() query with this embedded-select query in one Promise.all
  // tuple defeats TypeScript's inference for both (the embedded query's
  // deep conditional type seems to blow the checker's budget and the
  // sibling tuple element's type degrades to `never` as a result).
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, status, created_at, upload:uploads(file_name, content_type, visual_source), clips(count)")
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  const projects = jobs ?? [];
  const planLabel =
    profile?.plan === "creator" ? "Creator" : profile?.plan === "studio" ? "Studio" : profile?.plan === "agency" ? "Agency" : "Free trial";
  const streak = profile ? currentStreak(profile.streak_count, profile.streak_last_active_date) : 0;

  return (
    <div className="nova-fade-in max-w-4xl mx-auto px-6 py-12 w-full">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="nova-display font-semibold mb-1 text-[22px] text-text">Your projects</h1>
          <p className="text-[13.5px] text-muted">{projects.length} upload{projects.length === 1 ? "" : "s"} processed</p>
        </div>
        <div className="flex items-center gap-2">
          {streak > 0 && (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-line nova-mono text-[12.5px] text-text">
              <Flame size={14} className="text-coral" />
              {streak} day{streak === 1 ? "" : "s"}
            </div>
          )}
          <Link href="/settings">
            <GhostButton className="px-3.5 py-2.5 text-muted text-[13.5px]">Brand kit</GhostButton>
          </Link>
          <Link href="/pricing">
            <GhostButton className="nova-mono px-3.5 py-2.5 text-[12.5px]">{planLabel} plan</GhostButton>
          </Link>
          <Link href="/upload">
            <PrimaryButton className="px-4 py-2.5 text-[13.5px]">
              <Plus size={15} /> New upload
            </PrimaryButton>
          </Link>
        </div>
      </div>

      {profile && (
        <Reveal>
          <div className="nova-card rounded-2xl px-5 py-4 mb-6 flex items-center justify-between flex-wrap gap-3">
            <div className="text-[13px] text-text">
              {profile.plan === "agency" || profile.plan === "trial" ? (
                <>
                  <span className="nova-mono">{profile.clips_remaining}</span> clips remaining on your trial
                  {profile.generated_clips_remaining > 0 && (
                    <span className="text-muted"> · {profile.generated_clips_remaining} can use generated visuals</span>
                  )}
                </>
              ) : (
                <>
                  <span className="nova-mono">
                    {(profile.clips_monthly_allowance ?? 0) - profile.clips_used_this_cycle}
                  </span>{" "}
                  of {profile.clips_monthly_allowance} clips left this cycle
                </>
              )}
            </div>
            {profile.plan === "trial" && (
              <Link href="/pricing" className="text-[12.5px] text-violet">
                Upgrade for more
              </Link>
            )}
          </div>
        </Reveal>
      )}

      {projects.length === 0 ? (
        <Reveal>
          <div className="nova-card rounded-2xl px-6 py-14 text-center">
            <FolderOpen size={26} className="text-muted mx-auto mb-3" />
            <div className="nova-display font-medium text-[15px] text-text mb-1">No uploads yet</div>
            <div className="text-[13px] text-muted mb-5">Your first 3 clips are on us.</div>
            <Link href="/upload">
              <PrimaryButton className="px-5 py-2.5 text-[13.5px] mx-auto">
                <Plus size={15} /> New upload
              </PrimaryButton>
            </Link>
          </div>
        </Reveal>
      ) : (
        <div className="flex flex-col gap-2.5">
          {projects.map((p, i) => (
            <Reveal key={p.id} delay={Math.min(i, 6) * 45}>
              <Link
                href={p.status === "done" ? `/jobs/${p.id}/results` : `/jobs/${p.id}`}
                className="nova-card nova-card-select rounded-2xl px-5 py-4 flex items-center justify-between text-left gap-4 flex-wrap"
              >
                <div className="flex items-center gap-3.5">
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
                <div className="flex items-center gap-1.5 nova-mono text-[12.5px] text-muted">
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
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
