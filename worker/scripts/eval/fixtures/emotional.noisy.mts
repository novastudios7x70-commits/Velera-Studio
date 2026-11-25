import type { Fixture } from "./types.mjs";

export const emotionalNoisy: Fixture = {
  id: "emotional-noisy",
  category: "emotional",
  variant: "noisy",
  version: "1.0",
  designNotes:
    "Same underlying story as emotional-clean, with filler words, a false start, run-ons, and a longer natural pause before the father's pivotal line. Tests whether 'self-containedness' and 'natural ending' selection survive realistic, halting delivery of emotionally heavy content.",
  sentences: [
    { text: "I didn't tell anyone this for, um, almost a year." },
    { text: "I was scared that if I said it out loud, it would- it would become real." },
    { text: "my dad was diagnosed the same week I got my acceptance letter" },
    { text: "and I almost didn't go, I almost just gave up the one thing I'd worked toward my whole entire life," },
    { text: "and he was the one who told me, you know, that I had to go, that staying wouldn't change anything for him.", pauseBeforeSeconds: 1.5 },
    { text: "I think about that conversation, like, every single day now." },
  ],
};
