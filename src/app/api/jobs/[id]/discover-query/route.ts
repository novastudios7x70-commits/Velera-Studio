import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkDiscoverQueryRateLimit } from "@/lib/rateLimit";
import { runDiscoverQuery } from "@/lib/discoverQuery";

const bodySchema = z.object({
  query: z.string().trim().min(1).max(300),
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
    return NextResponse.json({ error: "Please enter a request." }, { status: 400 });
  }

  // RLS ("own jobs") already scopes this to the caller's row — a user
  // cannot fetch, and therefore cannot query against, a job they don't own.
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*, upload:uploads(content_type)")
    .eq("id", id)
    .single();
  if (jobError || !job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (job.status !== "awaiting_selection") {
    return NextResponse.json({ error: "This job isn't waiting on a selection." }, { status: 409 });
  }

  const segments = job.selected_segments ?? [];
  if (segments.length === 0 || !job.upload) {
    return NextResponse.json({ error: "No moments to search." }, { status: 400 });
  }

  const rateLimit = await checkDiscoverQueryRateLimit(user.id, id);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimit.reason }, { status: 429 });
  }

  const result = await runDiscoverQuery(parsed.data.query, job.upload.content_type, segments, job.transcript);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ matches: result.matches });
}
