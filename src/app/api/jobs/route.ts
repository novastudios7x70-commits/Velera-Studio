import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPipelineQueue } from "@/lib/queue";

const bodySchema = z.object({
  file_path: z.string().min(1),
  file_name: z.string().min(1),
  content_type: z.enum(["music", "spoken"]),
  visual_source: z.enum(["has", "generate"]),
  mood_description: z.string().max(500).optional(),
  beat_sync_enabled: z.boolean().default(false),
  visual_style: z
    .object({
      prompt: z.string().max(400).optional(),
      mood: z.string().max(80).optional(),
      genre: z.string().max(80).optional(),
      color: z.string().max(40).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  if (body.visual_source === "generate" && process.env.GENERATE_VISUALS_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Generated visuals aren't available right now — please upload footage instead." },
      { status: 403 },
    );
  }

  // 1. Record the upload. RLS ("own uploads") requires user_id = auth.uid(),
  // which this server client satisfies since it's bound to the caller's session.
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .insert({
      user_id: user.id,
      file_url: body.file_path,
      file_name: body.file_name,
      content_type: body.content_type,
      visual_source: body.visual_source,
      mood_description: body.mood_description ?? null,
      beat_sync_enabled: body.content_type === "music" ? body.beat_sync_enabled : false,
      visual_style: body.visual_source === "generate" ? body.visual_style ?? null : null,
    })
    .select()
    .single();

  if (uploadError || !upload) {
    return NextResponse.json({ error: "Could not save upload." }, { status: 500 });
  }

  // 2. Atomically check + reserve a clip credit and create the job row.
  // create_job() returns a single `jobs` row (not SETOF), so the RPC result
  // is already a single object — no .single() narrowing needed/available.
  const { data: job, error: jobError } = await supabase.rpc("create_job", { p_upload_id: upload.id });

  if (jobError || !job) {
    const message = jobError?.message?.includes("remaining") || jobError?.message?.includes("allowance")
      ? "You're out of clip credits on your current plan."
      : "Could not start this job.";
    return NextResponse.json({ error: message }, { status: 402 });
  }

  // 3. Hand off to the worker via the queue — processing never happens inline.
  await getPipelineQueue().add("process-job", { jobId: job.id }, { jobId: job.id });

  return NextResponse.json({ job }, { status: 201 });
}
