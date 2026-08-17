import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewView } from "@/components/screens/ReviewView";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/jobs/${id}/results`);

  const { data: job } = await supabase
    .from("jobs")
    .select("*, upload:uploads(file_name, content_type, visual_source)")
    .eq("id", id)
    .single();
  if (!job) notFound();
  if (job.status !== "done") redirect(`/jobs/${id}`);

  const { data: clips } = await supabase
    .from("clips")
    .select("*")
    .eq("job_id", id)
    .order("created_at", { ascending: true });

  return <ReviewView job={job} clips={clips ?? []} />;
}
