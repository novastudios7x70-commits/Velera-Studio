import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPipelineQueue } from "@/lib/queue";
import { ACCEPTED_UPLOAD_EXTENSIONS, hasAcceptedUploadExtension } from "@/lib/uploadFormats";

const bodySchema = z
  .object({
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
    audio_source: z.enum(["upload", "tts"]).default("upload"),
    // "upload" path
    file_path: z.string().min(1).optional(),
    file_name: z.string().min(1).optional(),
    // "tts" path — a typed script instead of a recording
    script_text: z.string().min(1).max(2000).optional(),
    tts_voice_id: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.audio_source === "upload"
        ? !!data.file_path && !!data.file_name
        : !!data.script_text && !!data.tts_voice_id,
    { message: "Missing required fields for the selected audio source." },
  );

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

  if (body.audio_source === "tts" && process.env.TTS_ENABLED !== "true") {
    return NextResponse.json(
      { error: "AI voiceover isn't available right now — please upload a recording instead." },
      { status: 403 },
    );
  }

  // file_path is client-supplied and stored as-is on the upload row, which
  // the worker later downloads with the service-role client (bypassing the
  // storage bucket's own owner-prefix RLS policies entirely). The upload UI
  // always uploads to `${user.id}/...` first, so a legitimate request's
  // file_path is always under the caller's own prefix — reject anything
  // else rather than trusting it, or a direct API call could point the
  // worker at another user's private storage object.
  if (body.audio_source === "upload" && !body.file_path!.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 403 });
  }

  // Defense-in-depth: the upload UI's own file picker/drag-and-drop already
  // reject unsupported formats, but that's client-side and bypassable (a
  // direct API call, or any gap in the UI check). Checked here, before any
  // row is written and before create_job() reserves a credit below, so an
  // unsupported file is rejected immediately rather than burning a credit
  // and failing minutes later inside the worker.
  if (body.audio_source === "upload" && !hasAcceptedUploadExtension(body.file_name!)) {
    return NextResponse.json(
      { error: `Unsupported file type — please upload ${ACCEPTED_UPLOAD_EXTENSIONS.join(", ")}.` },
      { status: 400 },
    );
  }

  // Snapshot the caller's current brand color onto this upload — same
  // reasoning as beat_sync_enabled/visual_style below: a per-job setting
  // copied once at creation, not read live from profiles during rendering,
  // so changing it later never changes an already-in-flight job's output.
  const { data: profile } = await supabase.from("profiles").select("brand_color").eq("id", user.id).single();

  // 1. Record the upload. RLS ("own uploads") requires user_id = auth.uid(),
  // which this server client satisfies since it's bound to the caller's session.
  const isTts = body.audio_source === "tts";
  const scriptPreview = body.script_text && body.script_text.length > 60 ? `${body.script_text.slice(0, 60)}…` : body.script_text;
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .insert({
      user_id: user.id,
      file_url: isTts ? null : (body.file_path ?? null),
      file_name: isTts ? `AI voiceover — ${scriptPreview}` : body.file_name!,
      content_type: body.content_type,
      visual_source: body.visual_source,
      mood_description: body.mood_description ?? null,
      beat_sync_enabled: body.content_type === "music" ? body.beat_sync_enabled : false,
      visual_style: body.visual_source === "generate" ? body.visual_style ?? null : null,
      audio_source: body.audio_source,
      script_text: isTts ? body.script_text! : null,
      tts_voice_id: isTts ? body.tts_voice_id! : null,
      brand_color: profile?.brand_color ?? null,
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
  // "discover" phase: analyze + select candidate moments, then stop at
  // awaiting_selection for the user to act on (see /api/jobs/[id]/confirm-selection).
  await getPipelineQueue().add("process-job", { jobId: job.id, phase: "discover" }, { jobId: job.id });

  return NextResponse.json({ job }, { status: 201 });
}
