import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BrandKitForm } from "@/components/screens/BrandKitForm";
import { ManageBillingButton } from "@/components/BillingButtons";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/dashboard");

  return (
    <div className="nova-fade-in max-w-lg mx-auto px-6 py-14 w-full">
      <Link href="/dashboard" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>
      <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
        Brand kit
      </TextEffect>
      <p className="mb-7 text-[13.5px] text-muted">Applied to every clip Velora Studio generates for you.</p>

      <BrandKitForm profile={profile} />

      <div className="mt-8 pt-8 border-t border-line">
        <div className="text-[12px] text-muted mb-2">Billing</div>
        {profile.plan === "trial" ? (
          <Link href="/pricing" className="text-[13.5px] text-violet">
            Upgrade to a paid plan
          </Link>
        ) : (
          <ManageBillingButton />
        )}
      </div>
    </div>
  );
}
