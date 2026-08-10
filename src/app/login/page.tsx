"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Lock } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PrimaryButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
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

        <Link href="/forgot-password" className="text-[12.5px] text-gold -mt-1 self-end">
          Forgot password?
        </Link>

        {state.error && <p className="text-[12.5px] text-ruby">{state.error}</p>}

        <PrimaryButton type="submit" disabled={pending} className="w-full py-3.5 text-[14.5px] mt-2">
          {pending ? "Logging in…" : "Log in"}
        </PrimaryButton>
      </form>

      <p className="text-center text-[12.5px] text-muted">
        New here?{" "}
        <Link href="/signup" className="text-gold">
          Start a free trial
        </Link>
      </p>
    </div>
  );
}
