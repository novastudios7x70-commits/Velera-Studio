import type { Fixture } from "./types.mjs";

export const comedyNoisy: Fixture = {
  id: "comedy-noisy",
  category: "comedy",
  variant: "noisy",
  version: "1.0",
  designNotes:
    "Same underlying story as comedy-clean, with filler words, a false start, run-ons, and a natural pause right before the silence beat lands. Tests whether 'natural ending' and 'payoff' selection survive realistic, rambling delivery.",
  sentences: [
    { text: "so I'm at my sister's wedding, right, and I'm giving the best man speech," },
    { text: "and I had this whole, like, bit planned about how we used to fight as kids, you know," },
    { text: "I get up there, everyone's looking at me, and I just- I completely forget the punchline." },
    { text: "so I just stand there for like, I don't know, ten full seconds in total silence,", pauseBeforeSeconds: 0.8 },
    { text: "and finally I just say, anyway, she's better than me at everything, and I sit back down." },
    { text: "and the room absolutely lost it, like way harder than the joke I actually planned." },
  ],
};
