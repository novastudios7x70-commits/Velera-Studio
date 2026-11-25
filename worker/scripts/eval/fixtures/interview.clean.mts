import type { Fixture } from "./types.mjs";

export const interviewClean: Fixture = {
  id: "interview-clean",
  category: "interview",
  variant: "clean",
  version: "1.0",
  designNotes:
    "A clear multi-beat failure story. A plausible good clip lives in sentences 3-6 (funding round -> cancellation -> revenue hit -> the stare-at-the-email beat) or 6-8 (the ending). Sentences 1-2 are setup/context and would be a weak standalone opener.",
  sentences: [
    { text: "Tell me about the moment you knew the company was going to fail." },
    { text: "Honestly, I didn't see it coming at all." },
    { text: "We had just closed our biggest funding round ever." },
    { text: "Then three weeks later our biggest customer canceled their entire contract." },
    { text: "That single call wiped out forty percent of our revenue overnight." },
    { text: "I remember staring at the email for ten minutes before I could even process it." },
    { text: "We tried everything, we cut costs, we called every investor we knew." },
    { text: "Six months later we shut the doors for good." },
  ],
};
