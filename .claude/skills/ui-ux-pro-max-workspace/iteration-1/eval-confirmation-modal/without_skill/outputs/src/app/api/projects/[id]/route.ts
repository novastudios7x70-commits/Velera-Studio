import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { objectPathFromPublicUrl } from "@/lib/storage-paths";

// A "project" on the dashboard is a `jobs` row. Deleting one deletes the
// whole upload → job → clips chain: `jobs.upload_id` and `clips.job_id` are
// both `on delete cascade` (0001_init.sql), so removing the parent `uploads`
// row is enough to clear every DB row. Storage objects aren't covered by
// that cascade, so we clean those up first, best-effort, before touching
// the DB row that owns them.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // RLS ("own jobs") already scopes this to the caller's rows — a job that
  // exists but belongs to someone else comes back as "not found", not
  // "forbidden", so we don't leak whether the id exists at all.
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, upload_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const [{ data: upload }, { data: clips }] = await Promise.all([
    supabase.from("uploads").select("file_url").eq("id", job.upload_id).single(),
    supabase.from("clips").select("file_url, thumbnail_url").eq("job_id", job.id),
  ]);

  // Best-effort storage cleanup — a failure here shouldn't block the user
  // from clearing the project out of their dashboard. `uploads.file_url` is
  // already stored as a bare object path; clip URLs are full public CDN
  // URLs and need the path pulled back out of them.
  const uploadsToRemove = upload?.file_url ? [upload.file_url] : [];
  const clipsToRemove = (clips ?? [])
    .flatMap((clip) => [
      objectPathFromPublicUrl("clips", clip.file_url),
      objectPathFromPublicUrl("clips", clip.thumbnail_url),
    ])
    .filter((path): path is string => Boolean(path));

  await Promise.all([
    uploadsToRemove.length > 0
      ? supabase.storage.from("uploads").remove(uploadsToRemove)
      : Promise.resolve(),
    clipsToRemove.length > 0 ? supabase.storage.from("clips").remove(clipsToRemove) : Promise.resolve(),
  ]).catch((err) => {
    console.error(`Storage cleanup failed for job ${job.id}:`, err);
  });

  // Deleting the upload cascades to the job and its clips. RLS ("own
  // uploads") is what actually authorizes this — not the ownership check
  // above, which only exists to return a clean 404.
  const { error: deleteError } = await supabase.from("uploads").delete().eq("id", job.upload_id);
  if (deleteError) {
    return NextResponse.json({ error: "Could not delete project." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
