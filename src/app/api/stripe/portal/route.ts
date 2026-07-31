import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

// Self-serve billing portal — Stripe's own UI covers cancel, plan change,
// and payment method updates. This is the "cancel must be exactly as easy
// as signup" requirement: one button here, not a "contact us to cancel" flow.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found — subscribe to a plan first." }, { status: 400 });
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/settings`,
  });

  return NextResponse.json({ url: session.url });
}
