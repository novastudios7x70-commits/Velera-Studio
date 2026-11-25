import type { Fixture } from "./types.mjs";

export const tutorialClean: Fixture = {
  id: "tutorial-clean",
  category: "tutorial",
  variant: "clean",
  version: "1.0",
  designNotes:
    "A problem -> cause -> fix -> result tutorial. A plausible good clip lives in sentences 2-4 (the real cause and fix) or 3-6 (fix through payoff). Sentence 1 alone is a weak opener — pure setup, no stakes yet.",
  sentences: [
    { text: "Today I'm going to show you how to fix the most common mistake beginners make with sourdough." },
    { text: "Most people think the problem is their starter, but it's almost never that." },
    { text: "The real issue is you're not giving the dough enough time to develop gluten structure." },
    { text: "Once you stretch and fold it every thirty minutes for the first two hours, everything changes." },
    { text: "Look at this crumb structure, this is what properly developed dough looks like." },
    { text: "That's the difference proper timing makes." },
  ],
};
