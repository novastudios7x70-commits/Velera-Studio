import type { Fixture } from "./types.mjs";

export const comedyClean: Fixture = {
  id: "comedy-clean",
  category: "comedy",
  variant: "clean",
  version: "1.0",
  designNotes:
    "A setup -> forgotten line -> silence -> save -> payoff-laugh story. A plausible good clip lives in sentences 3-6 (the whole comedic beat). Sentences 1-2 alone are pure setup — a weak standalone opener.",
  sentences: [
    { text: "So I'm at my sister's wedding, right, and I'm giving the best man speech." },
    { text: "I had this whole bit planned about how we used to fight as kids." },
    { text: "I get up there, everyone's looking at me, and I completely forget the punchline." },
    { text: "So I just stand there for like ten full seconds in total silence." },
    { text: "Finally I just say, anyway, she's better than me at everything, and I sit back down.", pauseBeforeSeconds: 1.2 },
    { text: "The room absolutely lost it, way harder than the joke I actually planned." },
  ],
};
