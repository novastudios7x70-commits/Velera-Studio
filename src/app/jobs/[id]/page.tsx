import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProcessingView } from "@/components/screens/ProcessingView";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/jobs/${id}`);

  const { data: job } = await supabase
    .from("jobs")
    .select("*, upload:uploads(file_name, content_type, visual_source, audio_source)")
    .eq("id", id)
    .single();

  if (!job) notFound();
  if (job.status === "done") redirect(`/jobs/${id}/results`);

  return <ProcessingView initialJob={job} />;
}
