import Link from "next/link";
import {
  ArrowRight, Sparkles, Music, Mic, Film, Wand2,
  FileText, ListChecks, Scissors, Send, Play, TrendingUp,
} from "lucide-react";
import { PrimaryButton } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { KineticWords } from "@/components/ui/KineticWords";
import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";
import { HowItWorksTimeline } from "@/components/blocks/how-it-works-timeline";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { AnimatedGroup } from "@/components/ui/motion-primitives/animated-group";
import { GlowEffect } from "@/components/ui/motion-primitives/glow-effect";

const STEPS = [
  { icon: FileText, title: "Analyze", copy: "We transcribe spoken content or read the energy and mood of a track." },
  { icon: Wand2, title: "Generate (optional)", copy: "No footage? We build visuals that match the mood before moving on." },
  { icon: ListChecks, title: "Select", copy: "An LLM finds the 3-5 moments most likely to hook a scroll." },
  { icon: Scissors, title: "Cut & caption", copy: "ffmpeg cuts the clip and burns in styled, word-synced captions." },
  { icon: Send, title: "Deliver", copy: "Every clip is reformatted and ready to download for each platform." },
];

const CONTENT_PATHS = [
  {
    icon: Music,
    accent: "gold" as const,
    title: "Music",
    copy: "We find the chorus, the hook, the bridge that hits — synced to the beat if you want it.",
    tilt: "-rotate-2",
  },
  {
    icon: Mic,
    accent: "gold" as const,
    title: "Talking / spoken",
    copy: "We transcribe and pull the 3-5 moments most likely to stop a scroll.",
    tilt: "rotate-0 sm:-translate-y-2",
  },
  {
    icon: Wand2,
    accent: "plum" as const,
    title: "No footage? Generate for me",
    copy: "Not a fallback — a first-class path. We build visuals that match your track or transcript before cutting.",
    tilt: "rotate-2",
  },
];

const PLATFORM_PILLS = ["TikTok", "Shorts", "Reels"];

const MARQUEE_ITEMS = [
  "TikTok", "YouTube Shorts", "Instagram Reels", "Facebook", "Pinterest",
  "No footage needed", "Music & spoken", "3 clips free",
];

function ClipMockup() {
  return (
    <div
      className="rounded-[24px] overflow-hidden relative flex flex-col justify-end"
      style={{ aspectRatio: "9 / 16", background: "linear-gradient(155deg, #1a1a22 0%, #101014 55%, #0a0a0e 100%)" }}
    >
      <div className="nova-noise" />
      <div
        className="absolute top-3 right-3 nova-mono text-[10px] px-2 py-1 rounded-full flex items-center gap-1"
        style={{ background: "rgba(201,162,39,0.22)", color: "#e8c04f", border: "1px solid rgba(232,192,79,0.4)" }}
      >
        <TrendingUp size={10} /> hook 94%
      </div>
      <div className="px-3.5 pb-3.5 flex flex-col gap-2.5 relative">
        <div className="flex items-end gap-0.5 h-6">
          {[6, 14, 9, 18, 11, 20, 8, 15, 10, 17, 7, 13].map((h, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full"
              style={{ height: `${h}px`, background: i % 3 === 0 ? "#e8c04f" : "#8a6b1a", opacity: 0.9 }}
            />
          ))}
        </div>
        <div
          className="nova-display font-semibold text-[13px] text-white leading-snug px-2 py-1.5 rounded-lg inline-block w-fit"
          style={{ background: "rgba(10,10,14,0.55)" }}
        >
          &ldquo;this is the part
          <br />
          nobody skips&rdquo;
        </div>
      </div>
    </div>
  );
}

function Marquee() {
  return (
    <div className="w-full overflow-hidden border-y border-line py-3.5" style={{ background: "var(--panel)" }}>
      <div className="flex w-max nova-marquee-track">
        {[0, 1].map((rep) => (
          <div key={rep} className="flex items-center shrink-0" aria-hidden={rep === 1}>
            {MARQUEE_ITEMS.map((item) => (
              <span key={item} className="flex items-center gap-6 px-6">
                <span className="nova-display font-medium text-[14px] text-text whitespace-nowrap">{item}</span>
                <Sparkles size={12} className="text-gold shrink-0" />
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
        eyebrow={
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6 nova-mono text-[12px] text-muted border border-line" style={{ background: "var(--panel)" }}>
            <Sparkles size={12} className="text-gold" /> built for musicians &amp; faceless creators
          </div>
        }
        title={
          <>
            <KineticWords text="One upload." />
            <br />
            <KineticWords
              text="A viral empire."
              delayStart={0.3}
              className="inline-block"
              style={{
                background: "linear-gradient(90deg, #e8c04f, var(--gold))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            />
          </>
        }
        description="Drop in a song, a video, or just an idea with no footage at all. Velora Studio finds the moments worth posting — and if you've got nothing to film with, it makes something for you."
        primaryCta={{ text: "Start free — 3 clips on us", href: "/signup" }}
        secondaryCta={{ text: "See how it works", href: "#how-it-works", icon: <Play size={14} /> }}
        mockup={
          <div className="flex flex-col gap-4 w-full">
            <ClipMockup />
            <div className="flex items-center justify-center gap-2">
              {PLATFORM_PILLS.map((p) => (
                <span key={p} className="nova-mono text-[10.5px] px-2.5 py-1 rounded-full border border-line text-muted">
                  {p}
                </span>
              ))}
            </div>
          </div>
        }
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

      {/* --- Content paths, slightly tilted like pinned mood-board cards --- */}
      <AnimatedGroup preset="blur-slide" className="max-w-5xl mx-auto px-6 py-24 w-full grid sm:grid-cols-3 gap-6 sm:gap-5">
        {CONTENT_PATHS.map((c) => (
          <div
            key={c.title}
            className={`nova-card rounded-2xl p-5 transition-transform duration-300 hover:rotate-0 hover:-translate-y-1 ${c.tilt}`}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center mb-3.5"
              style={{ background: c.accent === "gold" ? "var(--gold-soft)" : "var(--plum-soft)" }}
            >
              <c.icon size={17} className={c.accent === "gold" ? "text-gold" : "text-plum"} />
            </div>
            <div className="nova-display font-medium text-[14.5px] text-text mb-1.5">{c.title}</div>
            <div className="text-[12.5px] text-muted leading-relaxed">{c.copy}</div>
          </div>
        ))}
      </AnimatedGroup>

      <div id="how-it-works" className="scroll-mt-20">
        <Reveal>
          <HowItWorksTimeline
            eyebrow="THE PIPELINE"
            title="How it works"
            description="One upload, five steps, straight to platform-ready clips."
            steps={STEPS}
          />
        </Reveal>
      </div>

      <div className="max-w-2xl mx-auto px-6 -mt-8 pb-20 w-full">
        <Reveal>
          <div
            className="rounded-2xl p-5 flex items-center gap-3.5"
            style={{ background: "linear-gradient(120deg, var(--plum-soft), var(--gold-soft))", border: "1px solid var(--line)" }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--plum-soft)" }}>
              <Film size={16} className="text-plum" />
            </div>
            <div className="text-[13px] text-text leading-relaxed">
              No footage? &ldquo;Generate for me&rdquo; is a first-class option, not an afterthought —
              visuals are built to match your track or transcript before the same
              cutting and captioning pipeline runs.
            </div>
          </div>
        </Reveal>
      </div>

      {/* --- Closing CTA --- */}
      <div className="max-w-5xl mx-auto px-6 pb-24 w-full">
        <Reveal>
          <div
            className="rounded-3xl px-8 py-14 text-center relative overflow-hidden"
            style={{ background: "linear-gradient(160deg, var(--panel) 0%, #201c14 100%)", border: "1px solid var(--line)" }}
          >
            <div
              className="absolute pointer-events-none"
              style={{
                top: -140,
                left: "50%",
                transform: "translateX(-50%)",
                width: 420,
                height: 420,
                borderRadius: "50%",
                background: "radial-gradient(circle, var(--gold-soft), transparent 70%)",
                filter: "blur(10px)",
              }}
            />
            <TextEffect
              as="h2"
              per="word"
              preset="fade-in-blur"
              className="nova-display font-semibold mb-3 text-[26px] sm:text-[30px] text-text tracking-[-0.02em] relative"
            >
              Post more, film less.
            </TextEffect>
            <p className="mb-8 mx-auto max-w-[420px] text-muted text-[14.5px] leading-relaxed relative">
              Your first 3 clips are free — no card, no catch. See what Velora Studio
              finds in your next upload.
            </p>
            <div className="relative inline-block">
              <GlowEffect colors={["#dbb44a", "#8a6b1a"]} mode="breathe" blur="soft" scale={0.94} duration={4} className="opacity-70 rounded-xl" />
              <Link href="/signup" className="inline-flex relative">
                <PrimaryButton className="px-8 py-3.5 text-[15px]">
                  Start free <ArrowRight size={17} />
                </PrimaryButton>
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </>
  );
}
