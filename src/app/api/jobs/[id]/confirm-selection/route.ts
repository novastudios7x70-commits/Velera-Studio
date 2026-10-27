import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPipelineQueue } from "@/lib/queue";

const bodySchema = z.object({
  // Indices into jobs.selected_segments. "Let Velora choose for me" sends
  // every index (reproducing the old fully-automatic behavior); manual
  // selection sends whichever subset the user picked on Discover.
  indices: z.array(z.number().int().nonnegative()).min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }

  // RLS ("own jobs") already scopes this to the caller's row.
  const { data: job, error: jobError } = await supabase.from("jobs").select("*").eq("id", id).single();
  if (jobError || !job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // Guards against a double-submit (e.g. two tabs) both trying to confirm
  // the same job and enqueueing the render step twice.
  if (job.status !== "awaiting_selection") {
    return NextResponse.json({ error: "This job isn't waiting on a selection." }, { status: 409 });
  }

  const segmentCount = job.selected_segments?.length ?? 0;
  const indices = [...new Set(parsed.data.indices)].filter((i) => i < segmentCount);
  if (indices.length === 0) {
    return NextResponse.json({ error: "No valid moments selected." }, { status: 400 });
  }

  // Sets status to "cutting" directly rather than adding another
  // in-between status — the render phase's own first step would set this
  // anyway, and it mirrors how "queued" already covers the equally brief
  // gap between job creation and the worker picking it up.
  const { error: updateError } = await supabase
    .from("jobs")
    .update({ status: "cutting", confirmed_segment_indices: indices })
    .eq("id", id)
    .eq("status", "awaiting_selection");
  if (updateError) return NextResponse.json({ error: "Could not confirm selection." }, { status: 500 });

  try {
    await getPipelineQueue().add("process-job", { jobId: id, phase: "transform" }, { jobId: `${id}-transform` });
  } catch (enqueueError) {
    console.error(`[api/jobs/confirm-selection] enqueue failed for job=${id}:`, enqueueError);

    // No credit is reserved at this step — the initial reservation already
    // happened at create_job() time, and any per-segment top-ups only
    // happen later inside the worker's transform phase — so there's
    // nothing to refund here, only the status flip to revert. Conditional
    // on still being 'cutting', same reasoning as jobs/route.ts: this call
    // throwing doesn't prove Redis never got the job.
    const { data: reverted, error: revertError } = await supabase
      .from("jobs")
      .update({ status: "awaiting_selection" })
      .eq("id", id)
      .eq("status", "cutting")
      .select("id");

    if (revertError) {
      console.error(`[api/jobs/confirm-selection] revert update failed for job=${id}:`, revertError);
      return NextResponse.json({ error: "Could not confirm selection — please try again." }, { status: 500 });
    }

    if (reverted && reverted.length > 0) {
      // Genuinely still 'cutting' — the enqueue really did fail, and the
      // revert correctly undid the status change so the user can retry.
      return NextResponse.json({ error: "Could not confirm selection — please try again." }, { status: 500 });
    }

    // Matched zero rows: the job already advanced past 'cutting', so the
    // enqueue evidently succeeded despite this request-side failure. Do
    // not overwrite real progress and do not report a false failure —
    // respond exactly as the success path below does.
    console.error(
      `[api/jobs/confirm-selection] enqueue appeared to fail for job=${id} but it already advanced past 'cutting' — treating as a successful enqueue.`,
    );
  }

  return NextResponse.json({ ok: true });
}
