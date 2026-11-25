import type { Fixture } from "./types.mjs";

export const tutorialNoisy: Fixture = {
  id: "tutorial-noisy",
  category: "tutorial",
  variant: "noisy",
  version: "1.0",
  designNotes:
    "Same underlying tutorial as tutorial-clean, with filler words, a false start, run-ons/comma splices, and a natural pause before showing the result. Tests the same boundary-handling questions against informal, unscripted-sounding instruction.",
  sentences: [
    { text: "Okay so today I'm, basically, gonna show you how to fix the most common mistake beginners make with sourdough." },
    { text: "most people think the problem is their starter but it's almost never that" },
    { text: "the real issue is, I mean, you're not- you're not giving the dough enough time to develop gluten structure," },
    { text: "and once you stretch and fold it every thirty minutes for like the first two hours, everything just changes, it's crazy." },
    { text: "look at this crumb structure right here, this is what properly developed dough actually looks like.", pauseBeforeSeconds: 0.6 },
    { text: "that's literally the difference proper timing makes." },
  ],
};
