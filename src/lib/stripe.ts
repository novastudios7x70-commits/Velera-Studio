import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
  }
  return stripe;
}

// Maps a Stripe Price ID back to our internal plan id — the only place this
// mapping lives, so webhook handling and checkout-session creation can't drift.
export function planForPriceId(priceId: string): "creator" | "studio" | null {
  if (priceId === process.env.STRIPE_PRICE_CREATOR) return "creator";
  if (priceId === process.env.STRIPE_PRICE_STUDIO) return "studio";
  return null;
}

export function priceIdForPlan(plan: "creator" | "studio"): string {
  const priceId = plan === "creator" ? process.env.STRIPE_PRICE_CREATOR : process.env.STRIPE_PRICE_STUDIO;
  if (!priceId) throw new Error(`No Stripe price configured for plan "${plan}"`);
  return priceId;
}
