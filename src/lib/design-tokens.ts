// Design tokens ported 1:1 from the Velora Studio UX reference (velora_demo.jsx).
// Keep this file as the single source of truth for the visual language —
// any new component should pull colors from here rather than hardcoding hex values.

export const INK = "#05030A";
export const VOID = "#0B0714"; // near-black with a faint purple tint
export const PANEL = "#1A1024"; // dark purple-black card surface
export const LINE = "rgba(255,255,255,0.10)";
export const VIOLET = "#A855F7"; // royal purple, primary accent
export const VIOLET_SOFT = "rgba(168,85,247,0.16)";
export const CORAL = "#D4AF37"; // gold, second accent
export const CORAL_SOFT = "rgba(212,175,55,0.16)";
export const RUBY = "#E63946"; // deep red, third accent
export const RUBY_SOFT = "rgba(230,57,70,0.16)";
export const TEXT = "#F5F1FA";
export const MUTED = "#9C8FAE";

export const PLATFORMS = [
  { id: "tiktok", label: "TikTok" },
  { id: "shorts", label: "YouTube Shorts" },
  { id: "reels", label: "Instagram Reels" },
  { id: "facebook", label: "Facebook" },
  { id: "pinterest", label: "Pinterest" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];

export const HOOK_LABELS: Record<string, string> = {
  surprising_claim: "Surprising claim",
  question: "Open question",
  contrarian: "Contrarian take",
  result_number: "Concrete result",
  emotional: "Emotional beat",
  chorus: "Chorus / hook",
  bridge: "Bridge moment",
};

export interface PlanDefinition {
  id: "creator" | "studio" | "agency";
  name: string;
  price: number | null;
  tagline: string;
  popular?: boolean;
  features: string[];
  clipsAllowance: number | null;
  generatedClipsAllowance: number | null;
}

export const PLANS: PlanDefinition[] = [
  {
    id: "creator",
    name: "Creator",
    price: 49,
    tagline: "For posting solo",
    features: [
      "15 clips / month",
      "Edit your own footage",
      "TikTok, Shorts, Reels, Facebook & Pinterest export",
      "Standard captions",
    ],
    clipsAllowance: 15,
    generatedClipsAllowance: 5,
  },
  {
    id: "studio",
    name: "Studio",
    price: 149,
    tagline: "For staying consistent",
    popular: true,
    features: [
      "60 clips / month",
      "Generated visuals included",
      "Priority processing",
      "Style presets & brand kit",
      "Everything in Creator",
    ],
    clipsAllowance: 60,
    generatedClipsAllowance: 20,
  },
  {
    id: "agency",
    name: "Agency",
    price: null,
    tagline: "For managing multiple artists or channels",
    features: [
      "Unlimited clips",
      "Multiple workspaces",
      "White-label exports",
      "Dedicated support",
    ],
    clipsAllowance: null,
    generatedClipsAllowance: null,
  },
];

export const TRIAL_CLIPS = 3;
export const TRIAL_GENERATED_CLIPS = 1;
