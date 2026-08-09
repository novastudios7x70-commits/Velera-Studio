"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PrimaryButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { GlowEffect } from "@/components/ui/motion-primitives/glow-effect";
import { resetPasswordAction, type AuthActionState } from "@/lib/auth-actions";

const initialState: AuthActionState = { error: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <div className="nova-fade-in max-w-sm mx-auto px-6 py-20 w-full">
      <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
        Set a new password
      </TextEffect>
      <p className="mb-7 text-[13.5px] text-muted">Min. 8 characters.</p>

      <form action={formAction} className="flex flex-col gap-3">
        <Field icon={Lock} type="password" name="password" placeholder="New password" required minLength={8} autoComplete="new-password" />

        {state.error && <p className="text-[12.5px] text-coral">{state.error}</p>}

        <div className="relative mt-2">
          <GlowEffect colors={["#A855F7", "#D4AF37", "#E63946"]} mode="breathe" blur="soft" scale={0.94} duration={4} className="opacity-50 rounded-xl" />
          <PrimaryButton type="submit" disabled={pending} className="relative w-full py-3.5 text-[14.5px]">
            {pending ? "Updating…" : "Update password"}
          </PrimaryButton>
        </div>
      </form>

      {state.error?.includes("expired") && (
        <p className="text-center text-[12.5px] text-muted mt-5">
          <Link href="/forgot-password" className="text-violet">
            Request a new link
          </Link>
        </p>
      )}
    </div>
  );
}
