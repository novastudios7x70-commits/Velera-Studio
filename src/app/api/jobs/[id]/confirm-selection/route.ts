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

  await getPipelineQueue().add("process-job", { jobId: id, phase: "transform" }, { jobId: `${id}-transform` });

  return NextResponse.json({ ok: true });
}
