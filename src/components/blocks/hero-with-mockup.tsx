import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/shadcn/button";

/**
 * Adapted from 21st.dev's "Hero with Mockup" (serafimcloud/hero-with-mockup),
 * stripped of the original's ambient glow wash — Velora is monochrome at
 * rest, so the hero has no decorative background treatment. Whatever's
 * passed as `mockup` (the actual product visual) is the only thing pulling
 * focus in this half of the layout.
 */
interface HeroWithMockupProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description: string;
  primaryCta: { text: string; href: string };
  secondaryCta?: { text: string; href: string; icon?: ReactNode };
  mockup: ReactNode;
  trustRow?: ReactNode;
  className?: string;
}

export function HeroWithMockup({
  eyebrow,
  title,
  description,
  primaryCta,
  secondaryCta,
  mockup,
  trustRow,
  className,
}: HeroWithMockupProps) {
  return (
    <section className={cn("relative overflow-hidden", className)}>
      <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-20 w-full">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
          <div className="relative z-10 nova-fade-in">
            {eyebrow}
            <h1 className="nova-display font-bold leading-[0.98] mb-5 text-[52px] sm:text-[60px] text-text tracking-[-0.03em]">
              {title}
            </h1>
            <p className="mb-8 max-w-[440px] text-muted text-[16px] leading-relaxed nova-fade-in" style={{ animationDelay: "80ms" }}>
              {description}
            </p>
            <div className="flex flex-wrap items-center gap-3 nova-fade-in" style={{ animationDelay: "150ms" }}>
              <Button asChild size="lg">
                <a href={primaryCta.href}>{primaryCta.text}</a>
              </Button>
              {secondaryCta && (
                <Button asChild size="lg" variant="outline">
                  <a href={secondaryCta.href}>
                    {secondaryCta.icon}
                    {secondaryCta.text}
                  </a>
                </Button>
              )}
            </div>
            {trustRow}
          </div>

          <div className="relative mx-auto lg:mx-0 w-full nova-fade-in" style={{ animationDelay: "220ms" }}>
            {mockup}
          </div>
        </div>
      </div>
    </section>
  );
}
