import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, planForPriceId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { PLANS } from "@/lib/design-tokens";
import { COMPANY } from "@/lib/company";
import type { Profile } from "@/lib/database.types";

// Stripe webhooks carry no user session — this route always uses the
// service-role admin client, and every write is scoped by an explicit
// customer/user id looked up from the event payload, never trusted from RLS.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.user_id;
        const plan = session.metadata?.plan as "creator" | "studio" | undefined;
        if (!userId || !plan || !session.customer || !session.subscription) break;

        const planDef = PLANS.find((p) => p.id === plan);
        await supabase
          .from("profiles")
          .update({
            plan,
            clips_monthly_allowance: planDef?.clipsAllowance ?? null,
            generated_clips_allowance: planDef?.generatedClipsAllowance ?? null,
            clips_used_this_cycle: 0,
            generated_clips_used_this_cycle: 0,
            billing_cycle_start: new Date().toISOString().slice(0, 10),
            stripe_customer_id: String(session.customer),
            stripe_subscription_id: String(session.subscription),
            stripe_subscription_status: "active",
          })
          .eq("id", userId);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason !== "subscription_cycle") break;
        const customerId = String(invoice.customer);
        await supabase
          .from("profiles")
          .update({
            clips_used_this_cycle: 0,
            generated_clips_used_this_cycle: 0,
            billing_cycle_start: new Date().toISOString().slice(0, 10),
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = String(subscription.customer);
        const priceId = subscription.items.data[0]?.price.id;
        const plan = priceId ? planForPriceId(priceId) : null;

        const update: Partial<Profile> = { stripe_subscription_status: subscription.status };
        if (plan) {
          const planDef = PLANS.find((p) => p.id === plan);
          update.plan = plan;
          update.clips_monthly_allowance = planDef?.clipsAllowance ?? null;
          update.generated_clips_allowance = planDef?.generatedClipsAllowance ?? null;
        }
        await supabase.from("profiles").update(update).eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = String(subscription.customer);

        const { data: profile } = await supabase
          .from("profiles")
          .select("id, email")
          .eq("stripe_customer_id", customerId)
          .single();

        await supabase
          .from("profiles")
          .update({
            plan: "trial",
            clips_remaining: 0,
            generated_clips_remaining: 0,
            clips_monthly_allowance: null,
            generated_clips_allowance: null,
            stripe_subscription_status: "canceled",
          })
          .eq("stripe_customer_id", customerId);

        if (profile?.email) {
          await sendEmail({
            to: profile.email,
            subject: "Your Velora Studio subscription has been cancelled",
            kind: "transactional",
            html: `<p>Your subscription has been cancelled and you won't be charged again. If this wasn't you, reply to this email or contact ${COMPANY.supportEmail}.</p>`,
          });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
