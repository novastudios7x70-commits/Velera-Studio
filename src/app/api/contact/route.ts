import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email";

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
