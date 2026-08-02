"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function CheckoutButton({
  plan,
  label,
  loggedIn,
}: {
  plan: "creator" | "studio";
  label: string;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleClick = async () => {
    if (!loggedIn) {
      router.push(`/signup?plan=${plan}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json().catch(() => null);
      if (json?.url) {
        window.location.href = json.url;
        return;
      }
      showToast(json?.error ?? `Could not start checkout (${res.status}).`, "error");
    } catch {
      showToast("Could not start checkout — please try again.", "error");
    }
    setLoading(false);
  };

  return (
    <PrimaryButton onClick={handleClick} disabled={loading} className="w-full py-2.5 text-[13.5px]">
      {loading ? "Redirecting…" : label}
    </PrimaryButton>
  );
}

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (json?.url) {
        window.location.href = json.url;
        return;
      }
      showToast(json?.error ?? "Could not open billing portal.", "error");
    } catch {
      showToast("Could not open billing portal — please try again.", "error");
    }
    setLoading(false);
  };

  return (
    <GhostButton onClick={handleClick} disabled={loading} className="px-4 py-2.5 text-[13.5px]">
      {loading ? "Loading…" : "Manage billing / cancel subscription"}
    </GhostButton>
  );
}
