"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/database.types";

export interface AuthActionState {
  error: string | null;
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
  const { error } = await supabase.auth.signUp({
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
