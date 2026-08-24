import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPipelineQueue } from "@/lib/queue";

// Mirrors worker/src/pipeline/selectSegments.ts's MIN_CLIP_SECONDS/
// MAX_CLIP_SECONDS and worker/src/jobRunner.ts's GENERATED_VISUAL_MAX_SECONDS.
// Duplicated rather than imported — src/ and worker/ never import across
// their package boundary (see CLAUDE.md), same reasoning as the
// hand-maintained database.types.ts copies.
const MIN_CLIP_SECONDS = 12;
const MAX_CLIP_SECONDS = 45;
const GENERATED_VISUAL_MAX_SECONDS = 45;

const bodySchema = z.object({
  startSec: z.number().finite(),
  endSec: z.number().finite(),
});

// Avoids Math.max(...array), which can blow the call-stack argument limit
// on a long transcript/analysis array.
function maxOf(values: number[]): number {
  return values.reduce((max, v) => (v > max ? v : max), 0);
}

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
  const { startSec, endSec } = parsed.data;

  // RLS ("own clips") already scopes this to the caller's rows.
  const { data: clip, error: clipError } = await supabase.from("clips").select("*").eq("id", id).single();
  if (clipError || !clip) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  // Every rendered clip has these populated — a null here means the clip
  // never finished its original render, which re-render doesn't apply to.
  if (!clip.start_time || !clip.end_time || !clip.title) {
    return NextResponse.json({ error: "This clip has no rendered moment to re-render." }, { status: 409 });
  }

  // RLS ("own jobs") already scopes this to the caller's rows.
  const { data: job, error: jobError } = await supabase.from("jobs").select("*").eq("id", clip.job_id).single();
  if (jobError || !job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "done") {
    return NextResponse.json({ error: "This job isn't in a state that supports re-rendering." }, { status: 409 });
  }

  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", job.upload_id)
    .single();
  if (uploadError || !upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  // The real source duration, computed once at discover time and stored
  // unscoped — even for generate-visual jobs, the generate-visual window
  // truncation only ever applied to local variables passed into segment
  // selection, never written back to the job row.
  let sourceDurationBound: number | null = null;
  if (upload.content_type === "spoken" && job.transcript) {
    sourceDurationBound = maxOf(job.transcript.words.map((w) => w.end / 1000));
  } else if (job.audio_analysis) {
    sourceDurationBound = maxOf(job.audio_analysis.windows.map((w) => w.end));
  }
  if (sourceDurationBound === null) {
    return NextResponse.json({ error: "Could not determine source duration." }, { status: 500 });
  }
  // Generated visuals only ever covered this window (see
  // GENERATED_VISUAL_MAX_SECONDS in jobRunner.ts) — the 12-45s clip-length
  // rule below still applies on top of this, unchanged.
  if (upload.visual_source === "generate") {
    sourceDurationBound = Math.min(sourceDurationBound, GENERATED_VISUAL_MAX_SECONDS);
  }

  const duration = endSec - startSec;
  if (
    startSec < 0 ||
    endSec <= startSec ||
    duration < MIN_CLIP_SECONDS ||
    duration > MAX_CLIP_SECONDS ||
    endSec > sourceDurationBound
  ) {
    return NextResponse.json({ error: "Invalid start/end range for this clip." }, { status: 400 });
  }

  // Mirrors ReviewView.tsx's groupClips key — the same 3 fields collapse a
  // moment's 5 platform rows into one group there, so re-deriving the full
  // moment here means the browser only ever has to send one clip id, not a
  // caller-supplied list of all 5 (which we wouldn't want to trust anyway).
  const { data: momentClips, error: momentError } = await supabase
    .from("clips")
    .select("id, render_started_at")
    .eq("job_id", clip.job_id)
    .eq("start_time", clip.start_time)
    .eq("end_time", clip.end_time)
    .eq("title", clip.title);
  if (momentError || !momentClips || momentClips.length === 0) {
    return NextResponse.json({ error: "Could not resolve this moment's clips." }, { status: 500 });
  }
  const momentClipIds = momentClips.map((c) => c.id);

  // Conditional claim: only succeeds if every row in the moment currently
  // has render_started_at = null. Postgres serializes concurrent UPDATEs
  // touching overlapping rows, so two simultaneous requests for the same
  // moment can't both win — one matches every row, the other matches none.
  // A partial match (only possible if the 5 rows were already
  // inconsistently null) is treated as a loss and rolled back below rather
  // than proceeding on an incomplete claim.
  const { data: claimed, error: claimError } = await supabase
    .from("clips")
    // Clearing render_failed_at here too — a fresh attempt shouldn't carry
    // over a previous attempt's failure marker while it's in flight.
    .update({ render_started_at: new Date().toISOString(), render_failed_at: null })
    .in("id", momentClipIds)
    .is("render_started_at", null)
    .select("id");
  if (claimError) {
    return NextResponse.json({ error: "Could not start re-render." }, { status: 500 });
  }
  const claimedIds = (claimed ?? []).map((c) => c.id);
  if (claimedIds.length < momentClipIds.length) {
    if (claimedIds.length > 0) {
      await supabase.from("clips").update({ render_started_at: null }).in("id", claimedIds);
    }
    return NextResponse.json({ error: "A re-render is already in progress for this moment." }, { status: 409 });
  }

  try {
    await getPipelineQueue().add("process-job", {
      jobId: clip.job_id,
      phase: "reclip",
      clipIds: momentClipIds,
      startSec,
      endSec,
    });
  } catch {
    // Compensate — never leave the flag stuck if the enqueue itself failed.
    await supabase.from("clips").update({ render_started_at: null }).in("id", momentClipIds);
    return NextResponse.json({ error: "Could not enqueue re-render." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
