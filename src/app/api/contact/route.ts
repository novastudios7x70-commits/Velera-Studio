import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  email: z.string().email(),
  details: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }
  const { name, company, email, details } = parsed.data;

  // Persistence is the real success condition — this used to only ever
  // send a best-effort notification email, so a missed/unset
  // CONTACT_NOTIFY_EMAIL or a failed Resend call silently lost the lead
  // with no record anywhere. No authenticated session exists on this
  // public form, so this goes through the service-role admin client
  // rather than the RLS-scoped one.
  const supabase = createAdminClient();
  const { error: insertError } = await supabase
    .from("leads")
    .insert({ name, company, email, details: details ?? null });

  if (insertError) {
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }

  // Best-effort from here down — the lead is already safely stored, so a
  // missing/failing notification email no longer means it's lost.
  const notifyEmail = process.env.CONTACT_NOTIFY_EMAIL;
  if (notifyEmail) {
    await sendEmail({
      to: notifyEmail,
      subject: `New agency lead: ${company}`,
      kind: "transactional",
      html: `<p><b>${name}</b> (${email}) at <b>${company}</b> wants to talk about the Agency plan.</p><p>${(details ?? "").replace(/</g, "&lt;")}</p>`,
    });
  }

  return NextResponse.json({ ok: true });
}
