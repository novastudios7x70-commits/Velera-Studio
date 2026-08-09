"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Lock, MailCheck, User } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PrimaryButton } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { ChromeBlob3D } from "@/components/ui/ChromeBlob3D";
import { signUpAction, type AuthActionState } from "@/lib/auth-actions";
import { PLANS } from "@/lib/design-tokens";

const initialState: AuthActionState = { error: null };

export function SignupForm() {
  const searchParams = useSearchParams();
  const presetPlan = searchParams.get("plan") ?? "studio";
  const [plan, setPlan] = useState(presetPlan);
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  if (state.info) {
    return (
      <div className="nova-fade-in max-w-md mx-auto px-6 py-16 w-full text-center">
        <div className="mx-auto mb-5 w-14 h-14 rounded-2xl flex items-center justify-center bg-violet-soft">
          <MailCheck size={22} className="text-violet" />
        </div>
        <h1 className="nova-display font-semibold mb-2 text-[20px] text-text">Check your email</h1>
        <p className="text-[13.5px] text-muted mb-6">{state.info}</p>
        <Link href="/login" className="text-[13px] text-violet">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-16 w-full relative">
      <div className="grid lg:grid-cols-[1fr_0.85fr] gap-14 items-center relative">
        <Reveal>
          <div className="max-w-md">
            <Link href="/" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
              <ArrowLeft size={14} /> back
            </Link>
            <h1 className="nova-display font-semibold mb-1 text-[26px] text-text">3 clips, free</h1>
            <p className="mb-7 text-[13.5px] text-muted">No credit card. No time limit — use them whenever.</p>

            <div className="nova-card rounded-2xl p-6">
              <form action={formAction} className="flex flex-col gap-3">
                <Field icon={User} name="name" placeholder="Your name" autoComplete="name" />
                <Field icon={Mail} type="email" name="email" placeholder="you@email.com" required autoComplete="email" />
                <Field icon={Lock} type="password" name="password" placeholder="Password (min. 8 characters)" required minLength={8} autoComplete="new-password" />

                <input type="hidden" name="plan" value={plan} />
                <div className="mt-2">
                  <div className="text-[12px] text-muted mb-2">Pick a plan to start with</div>
                  <div className="grid grid-cols-3 gap-2">
                    {PLANS.filter((p) => p.price).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlan(p.id)}
                        className="nova-card-select rounded-xl py-3 text-center"
                        style={{
                          background: plan === p.id ? "var(--violet-soft)" : "var(--void)",
                          border: `1px solid ${plan === p.id ? "var(--violet)" : "var(--line)"}`,
                        }}
                      >
                        <div className="nova-display font-medium text-[12.5px] text-text">{p.name}</div>
                        <div className="nova-mono text-[10.5px] text-muted mt-0.5">${p.price}/mo</div>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-start gap-2.5 mt-3 text-[12px] text-muted">
                  <input type="checkbox" name="terms_accepted" required className="mt-0.5 accent-violet" />
                  <span>
                    I agree to the{" "}
                    <Link href="/terms" className="text-violet" target="_blank">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="text-violet" target="_blank">
                      Privacy Policy
                    </Link>
                    , and confirm I own or have rights to whatever I upload.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-[12px] text-muted">
                  <input type="checkbox" name="marketing_consent" className="mt-0.5 accent-violet" />
                  <span>Send me product updates and tips (optional — you can unsubscribe anytime).</span>
                </label>

                {state.error && <p className="text-[12.5px] text-coral mt-1">{state.error}</p>}

                <PrimaryButton type="submit" disabled={pending} className="w-full py-3.5 text-[14.5px] mt-3 mb-1">
                  {pending ? "Creating your account…" : "Start free trial"}
                </PrimaryButton>
              </form>
            </div>

            <p className="text-center text-[12.5px] text-muted mt-5">
              Already have an account?{" "}
              <Link href="/login" className="text-violet">
                Log in
              </Link>
            </p>
          </div>
        </Reveal>

        <div className="hidden lg:block relative" style={{ height: 420 }}>
          <ChromeBlob3D className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
}
