"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Lock } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PrimaryButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { GlowEffect } from "@/components/ui/motion-primitives/glow-effect";
import { logInAction, type AuthActionState } from "@/lib/auth-actions";

const initialState: AuthActionState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(logInAction, initialState);

  return (
    <div className="nova-fade-in max-w-sm mx-auto px-6 py-20 w-full">
      <Link href="/" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>
      <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
        Welcome back
      </TextEffect>
      <p className="mb-7 text-[13.5px] text-muted">Log in to see your clips.</p>

      <form action={formAction} className="flex flex-col gap-3 mb-5">
        <Field icon={Mail} type="email" name="email" placeholder="you@email.com" required autoComplete="email" />
        <Field icon={Lock} type="password" name="password" placeholder="Password" required autoComplete="current-password" />

        {state.error && <p className="text-[12.5px] text-coral">{state.error}</p>}

        <div className="relative mt-2">
          <GlowEffect colors={["#A855F7", "#D4AF37", "#E63946"]} mode="breathe" blur="soft" scale={0.94} duration={4} className="opacity-50 rounded-xl" />
          <PrimaryButton type="submit" disabled={pending} className="relative w-full py-3.5 text-[14.5px]">
            {pending ? "Logging in…" : "Log in"}
          </PrimaryButton>
        </div>
      </form>

      <p className="text-center text-[12.5px] text-muted">
        New here?{" "}
        <Link href="/signup" className="text-violet">
          Start a free trial
        </Link>
      </p>
    </div>
  );
}
