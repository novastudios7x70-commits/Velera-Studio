import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  display_name: z.string().max(100).optional(),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  marketing_email_consent: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });

  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Update failed." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
