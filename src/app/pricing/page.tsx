import Link from "next/link";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/design-tokens";
import { CheckoutButton } from "@/components/BillingButtons";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { AnimatedGroup } from "@/components/ui/motion-primitives/animated-group";

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("plan").eq("id", user.id).single()
    : { data: null };

  return (
    <div className="nova-fade-in max-w-4xl mx-auto px-6 py-14 w-full">
      <div className="text-center mb-10">
        <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1.5 text-[24px] text-text">
          Simple pricing, cancel anytime
        </TextEffect>
        <p className="text-[14px] text-muted">3 clips free on any plan. No credit card until you upgrade.</p>
      </div>

      <AnimatedGroup preset="blur-slide" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((p) => {
          const active = profile?.plan === p.id;
          return (
            <div
              key={p.id}
              className="nova-card rounded-lg p-6 flex flex-col relative"
              style={{ borderColor: p.popular ? "rgba(255,255,255,0.28)" : "var(--line)", borderWidth: p.popular ? 1.5 : 1 }}
            >
              {p.popular && (
                <div className="nova-mono absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[10px] bg-text text-ink">
                  most popular
                </div>
              )}
              <div className="nova-display font-semibold mb-0.5 text-[18px] text-text">{p.name}</div>
              <div className="text-[12.5px] text-muted mb-3.5">{p.tagline}</div>
              <div className="mb-5 flex items-baseline gap-1">
                {p.price ? (
                  <>
                    <span className="nova-display font-bold text-[30px] text-text">${p.price}</span>
                    <span className="text-[12.5px] text-muted">/mo</span>
                  </>
                ) : (
                  <span className="nova-display font-bold text-[22px] text-text">Let&apos;s talk</span>
                )}
              </div>
              <div className="flex flex-col gap-2.5 mb-6 flex-1">
                {p.features.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <Check size={14} className="text-text mt-0.5 shrink-0" />
                    <span className="text-[13px] text-text">{f}</span>
                  </div>
                ))}
              </div>
              {active ? (
                <div className="py-2.5 rounded-[10px] text-[13.5px] font-semibold text-center border border-line text-text nova-display">
                  Current plan
                </div>
              ) : p.price ? (
                <CheckoutButton
                  plan={p.id as "creator" | "studio"}
                  // Logged-out clicks route to signup (the actual 3-clip,
                  // no-card trial), so "free trial" is accurate there — but
                  // for an already-signed-up user this button goes straight
                  // to a paid Stripe checkout with no trial period, so
                  // calling it a "free trial" would be misleading.
                  label={user ? `Upgrade to ${p.name}` : "Start free trial"}
                  loggedIn={!!user}
                />
              ) : (
                <Link
                  href="/contact"
                  className="nova-btn-primary nova-display font-semibold w-full py-2.5 rounded-[10px] text-center text-[13.5px]"
                >
                  Contact sales
                </Link>
              )}
            </div>
          );
        })}
      </AnimatedGroup>
    </div>
  );
}
