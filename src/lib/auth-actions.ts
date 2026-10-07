"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/database.types";

export interface AuthActionState {
  error: string | null;
  /** Non-error status to show the user, e.g. "check your email to confirm." */
  info?: string | null;
}

export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const plan = String(formData.get("plan") ?? "studio") as Plan;
  const termsAccepted = formData.get("terms_accepted") === "on";
  const marketingConsent = formData.get("marketing_consent") === "on";

  if (!termsAccepted) {
    return { error: "You must accept the Terms of Service and Privacy Policy to continue." };
  }
  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  // Plan is chosen at signup but billing (Stripe checkout) is a separate,
  // explicit step — a brand-new profile always starts on 'trial' regardless
  // of the plan picked here (handle_new_user() never sees this value). The
  // choice still isn't thrown away, though: it decides where signup sends
  // the user next, so picking Creator/Studio actually leads somewhere
  // instead of silently landing on the same dashboard as everyone else.
  // Agency has no price and was never a selectable option in the picker, so
  // it (and anything else unexpected) falls back to the plain dashboard.
  const nextPath = plan === "creator" || plan === "studio" ? `/pricing?plan=${plan}` : "/dashboard";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: name || null,
        terms_accepted: true,
        marketing_email_consent: marketingConsent,
      },
      // Reuses /auth/callback's existing ?next= redirect (already used by
      // the password-reset flow) rather than inventing a second mechanism —
      // this is what carries the chosen plan across the "confirm your
      // email first" gap, where there's no session yet to redirect with.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(nextPath)}`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // Supabase projects with "Confirm email" on (the default) don't return a
  // session until the user clicks the emailed confirmation link — redirecting
  // to /dashboard here would just bounce them back to /login with no
  // explanation, so tell them what's actually happening instead.
  if (!data.session) {
    return {
      error: null,
      info: `We sent a confirmation link to ${email} — click it to activate your account, then log in.`,
    };
  }

  revalidatePath("/", "layout");
  redirect(nextPath);
}

export async function logInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed" || /confirm/i.test(error.message)) {
      return {
        error: "Please confirm your email first — check your inbox for the link we sent when you signed up.",
      };
    }
    // Only a real GoTrue "invalid_credentials" response (or the legacy
    // pre-error-code message text Supabase used before structured codes
    // existed) means the password was actually wrong — see the Storage/
    // auth error-masking audit. Everything else (rate limiting, 5xx,
    // network failure, a paused/quota-restricted project, or any other
    // unrecognized error) has no dedicated code to check for, so treating
    // it as "wrong password" by default was the bug being fixed here.
    if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
      return { error: "Incorrect email or password." };
    }
    // Logged with only non-sensitive error metadata — never email,
    // password, or any token/session value (no session exists on a failed
    // sign-in anyway) — so there's an operational signal for a real outage
    // without putting secrets in logs.
    console.error(`[auth] signInWithPassword failed: name=${error.name} code=${error.code ?? "n/a"} status=${error.status ?? "n/a"}`);
    return { error: "We couldn't log you in right now — please try again in a moment." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function logOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function forgotPasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Enter your email address." };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  });

  // Always return the same message whether or not the email is registered —
  // confirming/denying an account's existence here would leak who has an
  // account, the same reason signUpAction doesn't distinguish "already
  // registered" from "confirmation sent."
  return {
    error: null,
    info: `If an account exists for ${email}, we've sent a link to reset your password.`,
  };
}

export async function resetPasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  // Only valid immediately after the recovery-link redirect from
  // auth/callback, which exchanges the emailed code for a short-lived
  // session scoped to this one update.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "This reset link has expired — request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
