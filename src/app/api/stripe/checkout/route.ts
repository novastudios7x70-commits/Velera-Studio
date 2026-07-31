import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdForPlan } from "@/lib/stripe";

const bodySchema = z.object({ plan: z.enum(["creator", "studio"]) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan." }, { status: 400 });

  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id, email").eq("id", user.id).single();

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: user.id,
    customer: profile?.stripe_customer_id ?? undefined,
    customer_email: profile?.stripe_customer_id ? undefined : profile?.email,
    line_items: [{ price: priceIdForPlan(parsed.data.plan), quantity: 1 }],
    // Renewal price/terms are shown on Stripe's own Checkout page before the
    // card is charged — required disclosure-before-charging per the FTC
    // click-to-cancel rule.
    success_url: `${siteUrl}/dashboard?checkout=success`,
    cancel_url: `${siteUrl}/pricing?checkout=cancelled`,
    metadata: { user_id: user.id, plan: parsed.data.plan },
    subscription_data: { metadata: { user_id: user.id, plan: parsed.data.plan } },
  });

  return NextResponse.json({ url: session.url });
}
