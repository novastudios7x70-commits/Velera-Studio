import type { Fixture } from "./types.mjs";

export const interviewNoisy: Fixture = {
  id: "interview-noisy",
  category: "interview",
  variant: "noisy",
  version: "1.0",
  designNotes:
    "Same underlying story as interview-clean, deliberately degraded: filler words, a false start, comma-spliced run-ons, missing/lowercase sentence starts, and a natural pause before the final beat. Tests whether sentence grouping and boundary snapping hold up against realistic transcription noise rather than clean text.",
  sentences: [
    { text: "So, um, tell me about, I guess, the moment you knew the company was gonna fail." },
    { text: "Honestly? I- I didn't see it coming at all, you know." },
    { text: "we had just closed our biggest funding round ever right" },
    { text: "and then, like, three weeks later our biggest customer just canceled the entire contract, no warning, nothing," },
    { text: "and that one call basically wiped out forty percent of our revenue overnight, which, I mean, that's insane when you think about it." },
    { text: "I just remember staring at the email for like ten minutes before I could even process it, I don't know how long it actually was." },
    { text: "we tried everything we cut costs we called every investor we knew" },
    { text: "and then six months later we just shut the doors for good.", pauseBeforeSeconds: 1.0 },
  ],
};
