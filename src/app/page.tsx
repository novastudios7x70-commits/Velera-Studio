import Link from "next/link";
import { ArrowRight, FileText, ListChecks, Scissors, Send, Play } from "lucide-react";
import { PrimaryButton } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";
import { HowItWorksTimeline } from "@/components/blocks/how-it-works-timeline";
import { TransformationDemo } from "@/components/ui/TransformationDemo";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";

const STEPS = [
  { icon: FileText, title: "Understand", copy: "Velora reads your upload — the transcript, the energy, the mood." },
  { icon: ListChecks, title: "Discover", copy: "It finds the moments most likely to hold someone's attention." },
  { icon: Scissors, title: "Transform", copy: "Reframed, captioned, and cut into a clip that's ready to post." },
  { icon: Send, title: "Export", copy: "Every clip comes out sized for the platform you're posting to." },
];

const STORY_LINES = [
  "Your best moments are buried.",
  "Finding them takes too much time.",
  "Velora finds the moments.",
  "Velora transforms them.",
  "You direct the final result.",
];

const INTENT_EXAMPLES = [
  "Find the funniest moments.",
  "Find the parts where I talk about football.",
  "Make this feel more energetic.",
  "Find moments that would make good TikToks.",
];

const PLATFORMS = ["TikTok", "YouTube Shorts", "Instagram Reels", "Facebook", "Pinterest"];

function Marquee() {
  return (
    <div className="w-full overflow-hidden border-y border-line py-3.5" style={{ background: "var(--panel)" }}>
      <div className="flex w-max nova-marquee-track">
        {[0, 1].map((rep) => (
          <div key={rep} className="flex items-center shrink-0" aria-hidden={rep === 1}>
            {PLATFORMS.map((p) => (
              <span key={p} className="px-6 nova-display font-medium text-[14px] text-muted whitespace-nowrap">
                {p}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <HeroWithMockup
        eyebrow={<div className="mb-6 text-muted text-[13px]">For musicians and creators</div>}
        title={
          <TextEffect as="span" per="word" preset="fade-in-blur">
            Turn your videos into something worth sharing.
          </TextEffect>
        }
        description="Velora finds the moments that matter, transforms them into polished content, and lets you direct the final result."
        primaryCta={{ text: "Start creating", href: "/signup" }}
        secondaryCta={{ text: "See how it works", href: "#how-it-works", icon: <Play size={14} /> }}
        mockup={<TransformationDemo className="w-full max-w-[280px] mx-auto lg:mx-0" />}
        trustRow={
          <div className="mt-6 nova-mono text-[11.5px] text-muted flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span>No credit card</span>
            <span className="w-1 h-1 rounded-full bg-line" />
            <span>3 free clips</span>
            <span className="w-1 h-1 rounded-full bg-line" />
            <span>5 platforms, one export</span>
          </div>
        }
      />

      <Marquee />

      {/* --- The story, told as a short sequence rather than a feature-card grid --- */}
      <div className="max-w-xl mx-auto px-6 py-24 w-full">
        <Reveal>
          <div className="flex flex-col gap-3.5">
            {STORY_LINES.map((line, i) => (
              <p
                key={line}
                className="nova-display text-[22px] sm:text-[26px] tracking-[-0.01em]"
                style={{ color: i >= 2 ? "var(--text)" : "var(--muted)", fontWeight: i >= 2 ? 600 : 500 }}
              >
                {line}
              </p>
            ))}
          </div>
        </Reveal>
      </div>

      <div id="how-it-works" className="scroll-mt-20">
        <Reveal>
          <HowItWorksTimeline
            eyebrow="THE PROCESS"
            title="How it works"
            description="One upload, four steps, straight to platform-ready clips."
            steps={STEPS}
          />
        </Reveal>
      </div>

      {/* --- Natural-language intent, illustrative only (real search is a later phase) --- */}
      <div className="max-w-xl mx-auto px-6 pb-24 w-full">
        <Reveal>
          <div className="text-center mb-6">
            <div className="nova-mono text-[11px] text-muted tracking-wide mb-2">TELL VELORA WHAT YOU WANT</div>
            <p className="text-[14px] text-muted">You don&apos;t need filters. Just say what you&apos;re looking for.</p>
          </div>
          <div className="flex flex-col gap-2">
            {INTENT_EXAMPLES.map((example) => (
              <div key={example} className="rounded-lg border border-line px-4 py-3 text-[13.5px] text-text bg-panel">
                &ldquo;{example}&rdquo;
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      {/* --- Closing CTA --- */}
      <div className="max-w-2xl mx-auto px-6 pb-24 w-full text-center">
        <Reveal>
          <TextEffect as="h2" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-3 text-[26px] sm:text-[30px] text-text tracking-[-0.02em]">
            Velora does the work. You direct the vision.
          </TextEffect>
          <p className="mb-8 mx-auto max-w-[420px] text-muted text-[14.5px] leading-relaxed">
            Your first 3 clips are free — no card, no catch.
          </p>
          <Link href="/signup" className="inline-flex">
            <PrimaryButton className="px-8 py-3.5 text-[15px]">
              Start creating <ArrowRight size={17} />
            </PrimaryButton>
          </Link>
        </Reveal>
      </div>
    </>
  );
}
