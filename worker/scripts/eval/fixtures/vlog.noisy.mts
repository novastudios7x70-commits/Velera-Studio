import type { Fixture } from "./types.mjs";

export const vlogNoisy: Fixture = {
  id: "vlog-noisy",
  category: "vlog",
  variant: "noisy",
  version: "1.0",
  designNotes:
    "Same underlying story as vlog-clean, with heavy filler throughout, run-ons, a false start, and lowercase/no-period sentence starts typical of unscripted vlog speech. Tests selection quality against the noisiest, least-structured content type in this set.",
  sentences: [
    { text: "okay so hi guys, welcome back, it's been a crazy week" },
    { text: "and so many of you have been asking about, like, the whole situation with the apartment," },
    { text: "and I wasn't really planning on talking about this on camera but whatever, I mean, let's just do it." },
    { text: "so basically the landlord tried to keep our entire deposit for a wall that was already- that was already damaged when we moved in," },
    { text: "and we had timestamped photos from move-in day proving it, so we just took it to small claims," },
    { text: "and we won, we got every single dollar back plus fees, and honestly I'm still kind of in shock.", pauseBeforeSeconds: 0.5 },
  ],
};
