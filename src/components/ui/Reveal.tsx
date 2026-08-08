"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Purposeful scroll-reveal, not decoration: content already exists and is
 * readable without JS (no opacity:0 in SSR markup that could get stuck
 * hidden) — this only adds a subtle rise+fade the first time a section
 * enters the viewport, matching this app's existing restrained motion
 * vocabulary (nova-fade-in) rather than a flashier scroll library.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(18px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
