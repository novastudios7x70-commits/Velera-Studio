import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Deletes an entire project (a job + its parent upload + its clips).
//
// `uploads.id` is the real root of a "project" — `jobs.upload_id` and
// `clips.job_id` both cascade (`on delete cascade`, see
// supabase/migrations/0001_init.sql), so removing the upload row removes
// the job and every clip row in one statement rather than three.
//
// RLS ("own uploads" / "own jobs", both `for all using (auth.uid() = user_id)`)
// is what actually enforces that a caller can only ever delete their own
// data — this handler never needs to (and never should) check ownership
// itself. A job that doesn't resolve under RLS reads as "not found," which
// also happens to be the right response for someone probing another
// user's job id.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, upload_id, upload:uploads(file_url)")
    .eq("id", id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Best-effort: remove the raw upload object from Storage. The `uploads`
  // bucket has an owner-scoped delete policy so this respects RLS the same
  // way the DB delete below does. Rendered clip files in the public `clips`
  // bucket are written by the worker under the service role and have no
  // client-facing delete policy yet (see CLAUDE.md "Known TODOs") — those
  // are left as an orphaned-object cleanup job rather than silently failing
  // the whole request here.
  const uploadFileUrl = Array.isArray(job.upload) ? job.upload[0]?.file_url : job.upload?.file_url;
  if (uploadFileUrl) {
    await supabase.storage.from("uploads").remove([uploadFileUrl]);
  }

  // Deleting the upload cascades to the job and its clips.
  const { error: deleteError } = await supabase.from("uploads").delete().eq("id", job.upload_id);
  if (deleteError) {
    return NextResponse.json({ error: "Could not delete this project." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
