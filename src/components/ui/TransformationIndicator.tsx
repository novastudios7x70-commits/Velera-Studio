"use client";

/**
 * Velora's transformation language: static = precise/structured, active =
 * fluid/alive. This is the small version — a single shape whose corners
 * relax and tighten on a loop, used wherever the product is genuinely
 * processing something (the understanding/processing screen). The accent
 * color only appears while this is animating; it never sits static in the
 * UI. Deliberately a different motion vocabulary from TransformationDemo
 * (radius-morph here vs. a horizontal→vertical reshape there) so the two
 * don't read as copies of each other, even though both are "geometric
 * settling into form."
 */
export function TransformationIndicator({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <div className={className} style={{ width: size, height: size }}>
      <div
        className="w-full h-full nova-transform-shape"
        style={{
          background: "var(--gold)",
        }}
      />
    </div>
  );
}
