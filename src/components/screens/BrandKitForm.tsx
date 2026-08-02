"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Mail } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { Profile } from "@/lib/database.types";

const COLORS = [
  { hex: "#14B8A6", name: "Teal" },
  { hex: "#F5A524", name: "Amber" },
  { hex: "#4ADE80", name: "Green" },
  { hex: "#38BDF8", name: "Sky blue" },
  { hex: "#F472B6", name: "Pink" },
];

export function BrandKitForm({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [color, setColor] = useState(profile.brand_color);
  const [marketingConsent, setMarketingConsent] = useState(profile.marketing_email_consent);
  const { showToast } = useToast();

  const save = async (patch: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        showToast("Could not save — please try again.", "error");
        return;
      }
      showToast("Saved");
    } catch {
      showToast("Could not save — please try again.", "error");
    }
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
              key={c.hex}
              onClick={() => {
                setColor(c.hex);
                save({ brand_color: c.hex });
              }}
              aria-label={c.name}
              aria-pressed={color === c.hex}
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: c.hex, border: color === c.hex ? "2px solid white" : "2px solid transparent" }}
            >
              {color === c.hex && <Check size={14} color="#0a0a0e" />}
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
