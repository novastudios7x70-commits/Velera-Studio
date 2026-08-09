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
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // Plan is chosen at signup but billing (Stripe checkout) is a separate,
  // explicit step — a brand-new profile starts on 'trial' regardless of the
  // plan the user picked here; /pricing is where the real subscription starts.
  void plan;

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
  redirect("/dashboard");
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
    return { error: "Incorrect email or password." };
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
