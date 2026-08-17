"use client";

import { VideoOff } from "lucide-react";

/**
 * Wraps the browser's native <video controls> rather than building custom
 * play/pause/scrub UI — play, pause, and scrubbing are handled by the
 * platform, avoiding cross-browser/mobile scrub-bar and accessibility
 * quirks a hand-built control bar would need to solve itself.
 *
 * Aspect-agnostic on purpose: a moment's vertical (9:16) file and its
 * pinterest (2:3) file are different aspect ratios, so this component
 * doesn't force one — the video sizes itself within whatever box the
 * caller gives it via `className`, letterboxed on a black background
 * rather than stretched or cropped.
 */
export function VideoPlayer({
  src,
  poster,
  className = "",
}: {
  src: string | null | undefined;
  poster?: string | null;
  className?: string;
}) {
  return (
    <div className={`relative rounded-xl overflow-hidden bg-black flex items-center justify-center ${className}`}>
      {src ? (
        <video
          controls
          playsInline
          preload="metadata"
          poster={poster ?? undefined}
          className="max-w-full max-h-full w-auto h-auto"
        >
          <source src={src} type="video/mp4" />
          Your browser doesn&apos;t support embedded video playback.
        </video>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-muted">
          <VideoOff size={22} />
          <span className="text-[12.5px]">Preview unavailable</span>
        </div>
      )}
    </div>
  );
}
