import Link from "next/link";
import {
  ArrowRight, Sparkles, Music, Mic, Film, Wand2,
  FileText, ListChecks, Scissors, Send,
} from "lucide-react";

const STEPS = [
  { icon: FileText, title: "Analyze", copy: "We transcribe spoken content or read the energy and mood of a track." },
  { icon: Wand2, title: "Generate (optional)", copy: "No footage? We build visuals that match the mood before moving on." },
  { icon: ListChecks, title: "Select", copy: "An LLM finds the 3-5 moments most likely to hook a scroll." },
  { icon: Scissors, title: "Cut & caption", copy: "ffmpeg cuts the clip and burns in styled, word-synced captions." },
  { icon: Send, title: "Deliver", copy: "Every clip is reformatted and ready to download for each platform." },
];

export default function Home() {
  return (
    <>
      <div className="nova-fade-in max-w-3xl mx-auto text-center px-6 pt-20 pb-16 relative w-full">
        <div
          className="nova-pulse-glow absolute pointer-events-none -z-10"
          style={{
            top: -80,
            left: "50%",
            transform: "translateX(-50%)",
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: "radial-gradient(circle, var(--violet-soft), transparent 70%)",
            filter: "blur(20px)",
          }}
        />
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6 nova-mono text-[12px] text-muted border border-line">
          <Sparkles size={12} className="text-violet" /> built for musicians &amp; faceless creators
        </div>
        <h1 className="nova-display font-bold leading-none mb-5 text-[56px] text-text tracking-[-0.03em]">
          One upload.
          <br />
          <span
            style={{
              background: "linear-gradient(90deg, var(--violet), var(--coral))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            A viral empire.
          </span>
        </h1>
        <p className="mx-auto mb-9 max-w-[480px] text-muted text-[16px] leading-relaxed">
          Drop in a song, a video, or just an idea with no footage at all.
          Velora Studio finds the moments worth posting — and if you&apos;ve got
          nothing to film with, it makes something for you.
        </p>
        <Link
          href="/signup"
          className="nova-btn-primary nova-display font-semibold px-7 py-3.5 rounded-xl inline-flex items-center gap-2 text-white text-[15px]"
        >
          Start free — 3 clips on us <ArrowRight size={17} />
        </Link>
        <div className="mt-4">
          <a href="#how-it-works" className="text-[12.5px] text-muted underline">
            see how it works first
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-16 w-full grid grid-cols-2 gap-3">
        <div className="nova-card rounded-2xl p-5">
          <Music size={18} className="text-violet mb-2.5" />
          <div className="nova-display font-medium text-[14px] text-text mb-1">Music</div>
          <div className="text-[12.5px] text-muted leading-snug">
            We find the chorus, the hook, the bridge that hits — synced to the beat if you want it.
          </div>
        </div>
        <div className="nova-card rounded-2xl p-5">
          <Mic size={18} className="text-coral mb-2.5" />
          <div className="nova-display font-medium text-[14px] text-text mb-1">Talking / spoken</div>
          <div className="text-[12.5px] text-muted leading-snug">
            We transcribe and pull the 3-5 moments most likely to stop a scroll.
          </div>
        </div>
      </div>

      <div id="how-it-works" className="max-w-4xl mx-auto px-6 py-16 w-full scroll-mt-20">
        <div className="text-center mb-10">
          <h2 className="nova-display font-semibold mb-1.5 text-[24px] text-text">How it works</h2>
          <p className="text-[14px] text-muted">One upload, five steps, straight to platform-ready clips.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="nova-card rounded-2xl p-4 flex flex-col gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-violet-soft flex items-center justify-center">
                <s.icon size={15} className="text-violet" />
              </div>
              <div className="nova-mono text-[10px] text-muted">STEP {i + 1}</div>
              <div className="nova-display font-medium text-[13.5px] text-text">{s.title}</div>
              <div className="text-[11.5px] text-muted leading-snug">{s.copy}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl p-5 flex items-center gap-3 border border-line">
          <Film size={18} className="text-violet shrink-0" />
          <div className="text-[13px] text-text">
            No footage? &ldquo;Generate for me&rdquo; is a first-class option, not an afterthought —
            visuals are built to match your track or transcript before the same
            cutting and captioning pipeline runs.
          </div>
        </div>
      </div>
    </>
  );
}
