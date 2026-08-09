import Link from "next/link";
import { RefreshCw, ArrowRight } from "lucide-react";
import { ClipThumb } from "@/components/ui/ClipThumb";
import { DownloadLink } from "@/components/ui/DownloadLink";
import { PrimaryButton, GhostButton } from "@/components/ui/Button";
import { TextEffect } from "@/components/ui/motion-primitives/text-effect";
import { AnimatedGroup } from "@/components/ui/motion-primitives/animated-group";
import { GlowEffect } from "@/components/ui/motion-primitives/glow-effect";
import { HOOK_LABELS, PLATFORMS } from "@/lib/design-tokens";
import type { Clip, ContentType, Job, VisualSource } from "@/lib/database.types";

type JobWithUpload = Job & {
  upload: { file_name: string; content_type: ContentType; visual_source: VisualSource } | null;
};

interface ClipGroup {
  key: string;
  title: string;
  hookType: string | null;
  confidence: number;
  durationSeconds: number;
  generated: boolean;
  thumbnailUrl: string | null;
  clips: Clip[];
}

function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function groupClips(clips: Clip[], generated: boolean): ClipGroup[] {
  const map = new Map<string, ClipGroup>();
  for (const clip of clips) {
    const key = `${clip.start_time}-${clip.end_time}-${clip.title}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        title: clip.title ?? "Clip",
        hookType: clip.hook_type,
        confidence: clip.confidence ?? 0,
        durationSeconds: clip.duration_seconds ?? 0,
        generated,
        thumbnailUrl: clip.thumbnail_url,
        clips: [],
      };
      map.set(key, group);
    }
    group.clips.push(clip);
  }
  return [...map.values()];
}

export function ResultsView({ job, clips }: { job: JobWithUpload; clips: Clip[] }) {
  const groups = groupClips(clips, job.upload?.visual_source === "generate");
  const restartHref = "/dashboard";

  return (
    <div className="nova-fade-in max-w-4xl mx-auto px-6 py-16 w-full">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <TextEffect as="h1" per="word" preset="fade-in-blur" className="nova-display font-semibold mb-1 text-[22px] text-text">
            {`${groups.length} clip${groups.length === 1 ? "" : "s"}, ready to post`}
          </TextEffect>
          <p className="text-[13.5px] text-muted">Formatted for TikTok, Shorts, Reels, Facebook &amp; Pinterest</p>
        </div>
        <Link href={restartHref}>
          <GhostButton className="px-4 py-2.5 text-[13.5px]">
            <RefreshCw size={14} /> Back to dashboard
          </GhostButton>
        </Link>
      </div>

      <AnimatedGroup preset="blur-slide" className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {groups.map((g, i) => (
          <div key={g.key} className="nova-card rounded-2xl overflow-hidden flex flex-col">
            <div className="p-2">
              <ClipThumb seed={i} generated={g.generated} thumbnailUrl={g.thumbnailUrl} fileUrl={g.clips[0]?.file_url} />
            </div>
            <div className="px-3.5 pb-3.5 pt-1 flex flex-col gap-2 flex-1">
              <div className="text-[13px] text-text leading-snug">{g.title}</div>
              <div className="flex items-center justify-between">
                <span className="nova-mono px-2 py-0.5 rounded-full text-[10px] bg-violet-soft text-violet">
                  {(g.hookType && HOOK_LABELS[g.hookType]) || g.hookType}
                </span>
                <span className="nova-mono text-[10px] text-muted">{formatDuration(g.durationSeconds)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="flex-1 rounded-full h-1 overflow-hidden bg-line">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${g.confidence}%`, background: g.confidence > 85 ? "#4ADE80" : "var(--violet)" }}
                  />
                </div>
                <span className="nova-mono text-[10px] text-muted">{g.confidence}%</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {g.clips.map((clip) => (
                  <DownloadLink
                    key={clip.id}
                    clipId={clip.id}
                    url={clip.file_url ?? "#"}
                    label={PLATFORMS.find((p) => p.id === clip.platform)?.label ?? clip.platform}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </AnimatedGroup>

      <div className="mt-10 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4 bg-violet-soft border border-violet/30">
        <div className="text-[13.5px] text-text max-w-[420px]">
          Got more to post? Turn your next upload into clips in the same three steps.
        </div>
        <Link href="/upload" className="relative">
          <GlowEffect colors={["#A855F7", "#D4AF37", "#E63946"]} mode="breathe" blur="soft" scale={0.92} duration={4} className="opacity-50 rounded-xl" />
          <PrimaryButton className="relative px-5 py-2.5 text-[13.5px]">
            New upload <ArrowRight size={14} />
          </PrimaryButton>
        </Link>
      </div>
    </div>
  );
}
