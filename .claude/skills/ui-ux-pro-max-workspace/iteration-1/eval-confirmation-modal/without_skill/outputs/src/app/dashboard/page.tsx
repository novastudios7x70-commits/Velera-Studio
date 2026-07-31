import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { ProjectList, type ProjectRow } from "@/components/screens/ProjectList";

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

  return (
    <div className="nova-fade-in max-w-4xl mx-auto px-6 py-12 w-full">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="nova-display font-semibold mb-1 text-[22px] text-text">Your projects</h1>
          <p className="text-[13.5px] text-muted">{projects.length} upload{projects.length === 1 ? "" : "s"} processed</p>
        </div>
        <div className="flex items-center gap-2">
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
      )}

      <ProjectList initialProjects={projects} />
    </div>
  );
}
