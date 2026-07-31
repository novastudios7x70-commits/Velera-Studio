import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Clip } from "@/lib/database.types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const update: Partial<Pick<Clip, "downloaded_at" | "marked_posted_at">> = {};
  if (body.action === "downloaded") update.downloaded_at = new Date().toISOString();
  if (body.action === "posted") update.marked_posted_at = new Date().toISOString();

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  // RLS ("own clips") already scopes this update to the caller's rows.
  const { error } = await supabase.from("clips").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: "Update failed." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
