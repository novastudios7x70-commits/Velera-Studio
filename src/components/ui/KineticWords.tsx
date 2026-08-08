"use client";

import { motion } from "motion/react";

/**
 * One-time staggered word-by-word entrance for a headline — a real,
 * on-load kinetic moment rather than a subtle fade, in the spirit of
 * animejs.com/motion.dev's kinetic-typography showcases. Not a loop:
 * fires once when the page mounts, then holds still.
 */
export function KineticWords({
  text,
  className,
  delayStart = 0,
  style,
}: {
  text: string;
  className?: string;
  delayStart?: number;
  style?: React.CSSProperties;
}) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          // Margin, not an embedded space character — trailing whitespace
          // inside an animated inline-block is unreliable across browsers
          // (it visibly collapsed in testing).
          className={`inline-block ${i < words.length - 1 ? "mr-[0.28em]" : ""}`}
          style={style}
          initial={{ opacity: 0, y: 28, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.65, delay: delayStart + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}
