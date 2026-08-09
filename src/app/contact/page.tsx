"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, User, Building2, Check } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { PrimaryButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { GlowEffect } from "@/components/ui/motion-primitives/glow-effect";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, email, details }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Something went wrong — please try again.");
      }
    } catch {
      setError("Something went wrong — please try again.");
    }
    setSubmitting(false);
  };

  return (
    <div className="nova-fade-in max-w-lg mx-auto px-6 py-16 w-full">
      <Link href="/pricing" className="flex items-center gap-1 mb-8 text-muted text-[13px]">
        <ArrowLeft size={14} /> back
      </Link>

      {!sent ? (
        <>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
            Let&apos;s build your content engine
          </TextEffect>
          <p className="mb-7 text-[13.5px] text-muted">
            For labels, agencies, and teams managing multiple artists or channels.
          </p>
          <div className="flex flex-col gap-3 mb-5">
            <Field icon={User} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <Field icon={Building2} placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
            <Field icon={Mail} type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="rounded-xl px-3.5 bg-panel border border-line">
              <textarea
                placeholder="How many artists / channels are you managing?"
                aria-label="How many artists / channels are you managing?"
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="w-full bg-transparent outline-none py-3 nova-root resize-none text-text text-[13.5px]"
              />
            </div>
          </div>
          {error && <p className="text-[12.5px] text-coral mb-3">{error}</p>}
          <div className="relative">
            {!!(name && company && email) && !submitting && (
              <GlowEffect colors={["#A855F7", "#D4AF37", "#E63946"]} mode="breathe" blur="soft" scale={0.94} duration={4} className="opacity-60 rounded-xl" />
            )}
            <PrimaryButton onClick={handleSubmit} disabled={submitting || !name || !company || !email} className="relative w-full py-3.5 text-[14.5px]">
              {submitting ? "Sending…" : "Send message"}
            </PrimaryButton>
          </div>
        </>
      ) : (
        <div className="text-center py-10">
          <div className="mx-auto mb-5 w-14 h-14 rounded-2xl flex items-center justify-center bg-violet-soft">
            <Check size={22} className="text-violet" />
          </div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-2 text-[20px] text-text">
            Message sent
          </TextEffect>
          <p className="text-[13.5px] text-muted">Someone from the team will reach out within a day.</p>
        </div>
      )}
    </div>
  );
}
