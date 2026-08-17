import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Clip } from "@/lib/database.types";

const bodySchema = z
  .object({
    action: z.enum(["downloaded", "posted", "approve", "reject", "edit_title"]),
    title: z.string().trim().min(1).max(140).optional(),
  })
  .refine((data) => data.action !== "edit_title" || !!data.title, {
    message: "Title is required for edit_title.",
  });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { action, title } = parsed.data;

  const update: Partial<Pick<Clip, "downloaded_at" | "marked_posted_at" | "approved_at" | "rejected_at" | "title">> = {};
  if (action === "downloaded") update.downloaded_at = new Date().toISOString();
  if (action === "posted") update.marked_posted_at = new Date().toISOString();
  // Approve/reject are mutually exclusive (also enforced by a DB check
  // constraint) — each clears the other's timestamp.
  if (action === "approve") {
    update.approved_at = new Date().toISOString();
    update.rejected_at = null;
  }
  if (action === "reject") {
    update.rejected_at = new Date().toISOString();
    update.approved_at = null;
  }
  // Editing the title clears both review-state timestamps — a hidden
  // (rejected) clip becomes visible again as Pending Review rather than
  // staying silently hidden with metadata the user can no longer see.
  if (action === "edit_title") {
    update.title = title;
    update.approved_at = null;
    update.rejected_at = null;
  }

  // RLS ("own clips") already scopes this update to the caller's rows.
  const { error } = await supabase.from("clips").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: "Update failed." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
