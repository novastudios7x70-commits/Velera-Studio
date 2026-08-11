"use client";

import { useEffect, useState } from "react";
import { Captions } from "lucide-react";

/**
 * The landing hero's visual — shows the actual product doing something
 * (a long video's timeline, a moment getting found, that moment becoming a
 * finished vertical clip) instead of an abstract 3D object. Shares
 * Velora's "geometric settles into fluid form" transformation language
 * with TransformationIndicator, but at a slower, narrative pace and a
 * different shape vocabulary (a segment lifting out of a timeline and
 * reshaping into a clip, not a radius-morph loop) so the two don't read
 * as the same animation.
 */
const SEGMENT_COUNT = 14;
const FOUND_INDEX = 8;

type Phase = "scanning" | "found" | "transformed";

export function TransformationDemo({ className }: { className?: string }) {
  const [phase, setPhase] = useState<Phase>("scanning");

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("transformed");
      return;
    }
    let cancelled = false;
    const cycle = async () => {
      while (!cancelled) {
        setPhase("scanning");
        await wait(1400);
        if (cancelled) return;
        setPhase("found");
        await wait(1100);
        if (cancelled) return;
        setPhase("transformed");
        await wait(2600);
      }
    };
    cycle();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={className}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="nova-mono text-[10.5px] text-muted mb-2.5 tracking-wide">YOUR UPLOAD</div>
          <div className="relative h-14 rounded-lg border border-line bg-panel overflow-hidden flex items-center px-1.5 gap-[3px]">
            {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
              const isTarget = i === FOUND_INDEX;
              const active = isTarget && phase !== "scanning";
              return (
                <div
                  key={i}
                  className="flex-1 rounded-sm transition-all duration-500"
                  style={{
                    height: active ? "70%" : "38%",
                    background: active ? "var(--gold)" : "rgba(255,255,255,0.14)",
                  }}
                />
              );
            })}
            <div
              className="absolute top-0 bottom-0 w-8 pointer-events-none transition-[left] ease-linear"
              style={{
                left: phase === "scanning" ? "94%" : "34%",
                transitionDuration: phase === "scanning" ? "1400ms" : "0ms",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
              }}
            />
          </div>
        </div>

        <div
          className="text-[12.5px] transition-opacity duration-400"
          style={{ color: phase === "scanning" ? "var(--muted)" : "var(--text)", opacity: phase === "scanning" ? 0.7 : 1 }}
        >
          {phase === "scanning" ? "Understanding your video…" : "Strong hook, clear payoff — 0:47"}
        </div>

        <div className="flex justify-center py-1">
          <div
            className="w-[104px] rounded-lg border overflow-hidden relative transition-all duration-700 ease-out"
            style={{
              aspectRatio: "9 / 16",
              borderColor: phase === "transformed" ? "rgba(255,255,255,0.16)" : "transparent",
              background: "#101012",
              opacity: phase === "scanning" ? 0 : 1,
              transform: phase === "scanning" ? "scale(0.9) translateY(6px)" : "scale(1) translateY(0)",
            }}
          >
            <div
              className="absolute inset-0 transition-opacity duration-500"
              style={{ opacity: phase === "transformed" ? 1 : 0, background: "linear-gradient(160deg, #17171a 0%, #101012 100%)" }}
            />
            {phase === "transformed" && (
              <div className="absolute bottom-2.5 left-2 right-2 flex items-center gap-1 nova-mono text-[8px] text-text/85">
                <Captions size={9} className="shrink-0" />
                <div className="h-[3px] flex-1 rounded-full bg-white/20" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
