import type { Fixture } from "./types.mjs";

export const vlogClean: Fixture = {
  id: "vlog-clean",
  category: "vlog",
  variant: "clean",
  version: "1.0",
  designNotes:
    "A situation -> evidence -> result vlog. A plausible good clip lives in sentences 4-6 (the dispute through the win). Sentences 1-3 are intro/filler-ish setup and would be a weak standalone opener.",
  sentences: [
    { text: "Okay so hi guys, welcome back, it's been a crazy week." },
    { text: "So many of you have been asking about the whole situation with the apartment." },
    { text: "I wasn't really planning on talking about this on camera but whatever, let's just do it." },
    { text: "Basically the landlord tried to keep our entire deposit for a wall that was already damaged when we moved in." },
    { text: "We had timestamped photos from move-in day proving it, so we took it to small claims." },
    { text: "We won, we got every single dollar back plus fees, and honestly I'm still kind of in shock." },
  ],
};
