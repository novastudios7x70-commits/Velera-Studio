"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Mail } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { Profile } from "@/lib/database.types";

const COLORS = ["#14B8A6", "#F5A524", "#4ADE80", "#38BDF8", "#F472B6"];

export function BrandKitForm({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [color, setColor] = useState(profile.brand_color);
  const [marketingConsent, setMarketingConsent] = useState(profile.marketing_email_consent);
  const { showToast } = useToast();

  const save = async (patch: Record<string, unknown>) => {
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    showToast("Saved");
  };

  return (
    <>
      <div className="mb-6">
        <div className="text-[12px] text-muted mb-2">Display name</div>
        <Field
          icon={Mail}
          placeholder="How captions credit you"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => save({ display_name: name })}
        />
      </div>

      <div className="mb-6">
        <div className="text-[12px] text-muted mb-2">Accent color</div>
        <div className="flex gap-2.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                save({ brand_color: c });
              }}
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: c, border: color === c ? "2px solid white" : "2px solid transparent" }}
            >
              {color === c && <Check size={14} color="#0a0a0e" />}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <div className="text-[12px] text-muted mb-2">Default export platforms</div>
        <div className="flex flex-wrap gap-2">
          {["TikTok", "YouTube Shorts", "Instagram Reels", "Facebook", "Pinterest"].map((p) => (
            <span key={p} className="nova-mono px-2.5 py-1.5 rounded-full flex items-center gap-1.5 text-[11.5px] bg-violet-soft text-violet">
              <Check size={11} /> {p}
            </span>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl p-4 mb-8 border border-line cursor-pointer">
        <div>
          <div className="text-[13.5px] text-text">Product updates &amp; tips</div>
          <div className="text-[12px] text-muted mt-0.5">Optional marketing emails — unsubscribe anytime</div>
        </div>
        <input
          type="checkbox"
          checked={marketingConsent}
          onChange={(e) => {
            setMarketingConsent(e.target.checked);
            save({ marketing_email_consent: e.target.checked });
          }}
          className="w-5 h-5 accent-violet shrink-0"
        />
      </label>

      <div className="rounded-xl p-4 bg-panel border border-line">
        <div className="text-[11.5px] text-muted mb-1.5">Preview</div>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full" style={{ background: color }} />
          <span className="text-[13px] text-text">{name || "your name"} · captions styled in your color</span>
        </div>
      </div>
    </>
  );
}
