// Design tokens — single source of truth for the visual language. Any new
// component should pull colors from here rather than hardcoding hex values.
//
// v2 palette: a graphite/charcoal foundation (post-production-studio dark,
// not a purple-tinted void) with gold promoted to the one dominant brand
// accent — "AI purple" is the exact look this product needs to avoid, and
// gold reads as film/award/premium instead. Plum (the old primary violet,
// deepened and desaturated) is kept only as a rare secondary — logo
// gradient, the odd highlight — not stamped on every button and badge.
// Ruby stays reserved strictly for destructive/error states.
export const INK = "#0A0A0B"; // true near-black, minimal tint
export const VOID = "#0C0C0E"; // page background — neutral graphite
export const PANEL = "#18181B"; // graphite panel/card surface
export const ELEVATED = "#1F2023"; // modals, popovers, active surfaces
export const LINE = "rgba(255,255,255,0.07)";
export const GOLD = "#C9A227"; // primary brand accent — cinematic gold, not AI purple
export const GOLD_SOFT = "rgba(201,162,39,0.14)";
export const PLUM = "#6E5A9E"; // rare secondary — deepened, desaturated from the old primary violet
export const PLUM_SOFT = "rgba(110,90,158,0.14)";
export const RUBY = "#E63946"; // destructive/error only
export const RUBY_SOFT = "rgba(230,57,70,0.14)";
export const TEXT = "#F2F0EC";
export const MUTED = "#8F8D92";

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
