// Step 2 quality evaluation — a small, reproducible, non-automated
// diagnostic comparing the OLD (pre-Step-2) and NEW spoken-content prompts
// against representative synthetic transcripts.
//
// This is deliberately NOT a *.test.mts file: it is never picked up by
// `npm test`'s glob, never imported by selectSegments.ts or jobRunner.ts,
// and makes no real Anthropic API call (the real call would cost real
// money and isn't something this change is authorized to spend without an
// explicit ask) — it only prints what each prompt variant actually
// contains for each fixture, which is what the qualitative rubric
// assessment in Step 2's report is based on.
//
// Lives in worker/scripts/ (alongside audio_analysis.py, this package's
// existing home for non-build tooling) rather than under src/, so it is
// excluded from both `tsc` and `npm run build` by tsconfig.json's
// "include": ["src"] — with no build-config changes needed.
//
// Run manually with: node --import tsx scripts/selectSegments.eval.mts
//
// This file is intentionally kept out of the production request path —
// it exists purely for a human (or a future, explicitly-authorized real
// model run) to read and compare, never executed as part of a job.

import { selectSegments } from "../src/pipeline/selectSegments.js";
import type { Transcript, TranscriptWord } from "../src/lib/database.types.js";

// --- fixture construction helpers ---

interface FixtureSentence {
  text: string;
  pauseBeforeSeconds?: number; // extra silence before this sentence starts (e.g. a comedic beat)
}

const WORDS_PER_SECOND = 2.5;
const DEFAULT_PAUSE_SECONDS = 0.3;

function wordsFromSentences(sentences: FixtureSentence[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let clockMs = 0;

  for (const sentence of sentences) {
    clockMs += (sentence.pauseBeforeSeconds ?? DEFAULT_PAUSE_SECONDS) * 1000;
    for (const token of sentence.text.split(/\s+/).filter(Boolean)) {
      const durationMs = (1 / WORDS_PER_SECOND) * 1000;
      words.push({ text: token, start: Math.round(clockMs), end: Math.round(clockMs + durationMs) });
      clockMs += durationMs;
    }
  }
  return words;
}

function fixtureTranscript(sentences: FixtureSentence[]): Transcript {
  const words = wordsFromSentences(sentences);
  return { full_text: words.map((w) => w.text).join(" "), words };
}

// --- the 5 representative fixtures ---

const FIXTURES: Record<string, FixtureSentence[]> = {
  interview: [
    { text: "So tell me, what was the moment you knew the company was going to fail." },
    { text: "Honestly, I didn't see it coming at all." },
    { text: "We had just closed our biggest funding round ever." },
    { text: "Then three weeks later our biggest customer canceled their entire contract." },
    { text: "That single call wiped out forty percent of our revenue overnight." },
    { text: "I remember staring at the email for ten minutes before I could even process it." },
  ],
  tutorial: [
    { text: "Today I'm going to show you how to fix the most common mistake beginners make with sourdough." },
    { text: "Most people think the problem is their starter, but it's almost never that." },
    { text: "The real issue is you're not giving the dough enough time to develop gluten structure." },
    { text: "Once you stretch and fold it every thirty minutes for the first two hours, everything changes." },
    { text: "Look at this crumb structure, this is what properly developed dough looks like." },
    { text: "That's the difference proper timing makes." },
  ],
  comedicStory: [
    { text: "So I'm at my sister's wedding, right, and I'm giving the best man speech." },
    { text: "I had this whole bit planned about how we used to fight as kids." },
    { text: "I get up there, everyone's looking at me, and I completely forget the punchline." },
    { text: "So I just stand there for like ten full seconds in total silence." },
    { text: "Finally I just say, anyway, she's better than me at everything, and I sit back down.", pauseBeforeSeconds: 1.2 },
    { text: "The room absolutely lost it, way harder than the joke I actually planned." },
  ],
  emotionalStory: [
    { text: "I didn't tell anyone this for almost a year." },
    { text: "I was scared that if I said it out loud, it would become real." },
    { text: "My dad was diagnosed the same week I got my acceptance letter." },
    { text: "I almost didn't go, I almost gave up the one thing I'd worked toward my whole life." },
    { text: "He was the one who told me I had to go, that staying wouldn't change anything for him.", pauseBeforeSeconds: 0.8 },
    { text: "I think about that conversation every single day now." },
  ],
  vlog: [
    { text: "Okay so hi guys, welcome back, it's been a crazy week." },
    { text: "So many of you have been asking about the whole situation with the apartment." },
    { text: "I wasn't really planning on talking about this on camera but whatever, let's just do it." },
    { text: "Basically the landlord tried to keep our entire deposit for a wall that was already damaged when we moved in." },
    { text: "We had timestamped photos from move-in day proving it, so we took it to small claims." },
    { text: "We won, we got every single dollar back plus fees, and honestly I'm still kind of in shock." },
  ],
};

// --- reconstruction of the pre-Step-2 prompt format, for comparison only ---
// (selectSegments.ts's shared "instructions" block is unchanged by Step 2 —
// copied here verbatim so the OLD-format transcript section below is the
// only thing that differs from what buildPrompt() produces today.)

function oldFormatPrompt(transcript: Transcript, maxEndSeconds: number): string {
  const instructions = `You select the 3-5 best short-form-video moments from the source below.
Return ONLY valid JSON matching this shape, nothing else:
{"segments":[{"start_time":number,"end_time":number,"hook_type":"surprising_claim"|"question"|"contrarian"|"result_number"|"emotional"|"chorus"|"bridge","suggested_caption":string,"confidence":0-100}]}

Rules:
- The source is only ${maxEndSeconds.toFixed(1)} seconds long — every segment's end_time must be <= ${maxEndSeconds.toFixed(1)}. Do not propose anything past that.
- Each segment must be self-contained and make sense with no other context.
- Clip length must be between 12 and ${Math.min(45, maxEndSeconds)} seconds.
- Prefer moments with a strong opening line/beat within the first 2 seconds (the "hook").
- suggested_caption is a short, punchy on-screen caption a creator would post with the clip — not a summary.
- confidence reflects how likely this specific moment is to stop a scroll, 0-100.
- Order segments by confidence, descending.
- For music, only use hook_type "chorus" or "bridge". For spoken content, use the other five types.`;

  const transcriptText = transcript.words.map((w) => `[${(w.start / 1000).toFixed(1)}s] ${w.text}`).join(" ");
  return `${instructions}\n\nTRANSCRIPT (word start times in seconds):\n${transcriptText}`;
}

// Captures the real, current prompt text selectSegments() builds, using
// the same injectable-client seam the test file uses — no real API call.
async function newFormatPrompt(transcript: Transcript, maxEndSeconds: number): Promise<string> {
  let captured = "";
  const fakeClient = {
    messages: {
      async create(args: { messages: { content: string }[] }) {
        captured = args.messages[0].content;
        // A minimal, always-valid response so selectSegments() returns on
        // the first attempt — we only care about what it SENT, not its
        // parsed result.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                segments: [{ start_time: 0, end_time: Math.min(maxEndSeconds, 20), hook_type: "emotional", suggested_caption: "x", confidence: 50 }],
              }),
            },
          ],
        };
      },
    },
  };
  await selectSegments("spoken", transcript, null, maxEndSeconds, fakeClient as unknown as Parameters<typeof selectSegments>[4]);
  return captured;
}

async function main() {
  for (const [name, sentences] of Object.entries(FIXTURES)) {
    const transcript = fixtureTranscript(sentences);
    const maxEndSeconds = transcript.words[transcript.words.length - 1].end / 1000 + 0.5;

    console.log(`\n${"=".repeat(80)}\nFIXTURE: ${name}\n${"=".repeat(80)}`);
    console.log(`\n--- OLD prompt (pre-Step-2 format) ---\n`);
    console.log(oldFormatPrompt(transcript, maxEndSeconds));
    console.log(`\n--- NEW prompt (Step 2) ---\n`);
    console.log(await newFormatPrompt(transcript, maxEndSeconds));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
