import type { Fixture } from "./types.mjs";

export const emotionalClean: Fixture = {
  id: "emotional-clean",
  category: "emotional",
  variant: "clean",
  version: "1.0",
  designNotes:
    "A secret -> reveal -> conflict -> resolution story. A plausible good clip lives in sentences 3-6 (the diagnosis through the father's line) or 4-6. Sentences 1-2 alone are setup without the concrete stakes yet.",
  sentences: [
    { text: "I didn't tell anyone this for almost a year." },
    { text: "I was scared that if I said it out loud, it would become real." },
    { text: "My dad was diagnosed the same week I got my acceptance letter." },
    { text: "I almost didn't go, I almost gave up the one thing I'd worked toward my whole life." },
    { text: "He was the one who told me I had to go, that staying wouldn't change anything for him.", pauseBeforeSeconds: 0.8 },
    { text: "I think about that conversation every single day now." },
  ],
};
