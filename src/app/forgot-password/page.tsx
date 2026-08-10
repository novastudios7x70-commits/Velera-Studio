"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PrimaryButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { forgotPasswordAction, type AuthActionState } from "@/lib/auth-actions";

const initialState: AuthActionState = { error: null };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);

  if (state.info) {
    return (
      <div className="nova-fade-in max-w-sm mx-auto px-6 py-20 w-full text-center">
        <div className="mx-auto mb-5 w-14 h-14 rounded-2xl flex items-center justify-center bg-gold-soft">
          <MailCheck size={22} className="text-gold" />
        </div>
        <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-2 text-[20px] text-text">
          Check your email
        </TextEffect>
        <p className="text-[13.5px] text-muted mb-6">{state.info}</p>
        <Link href="/login" className="text-[13px] text-gold">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="nova-fade-in max-w-sm mx-auto px-6 py-20 w-full">
      <Link href="/login" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>
      <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
        Reset your password
      </TextEffect>
      <p className="mb-7 text-[13.5px] text-muted">We&apos;ll email you a link to set a new one.</p>

      <form action={formAction} className="flex flex-col gap-3">
        <Field icon={Mail} type="email" name="email" placeholder="you@email.com" required autoComplete="email" />

        {state.error && <p className="text-[12.5px] text-ruby">{state.error}</p>}

        <PrimaryButton type="submit" disabled={pending} className="w-full py-3.5 text-[14.5px] mt-2">
          {pending ? "Sending…" : "Send reset link"}
        </PrimaryButton>
      </form>
    </div>
  );
}
