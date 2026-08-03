import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/shadcn/button";
import { Mockup } from "@/components/ui/shadcn/mockup";
import { Glow } from "@/components/ui/shadcn/glow";

/**
 * Adapted from 21st.dev's "Hero with Mockup" (serafimcloud/hero-with-mockup).
 * Differs from the original registry version in two ways: takes a `mockup`
 * node instead of a static `mockupImage` (this product has no marketing
 * screenshot to point at), and skins Button/Glow through this app's
 * existing token bridge instead of shadcn's default palette.
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

          <div className="relative mx-auto lg:mx-0 w-full max-w-[280px] nova-fade-in" style={{ animationDelay: "220ms" }}>
            <Mockup type="mobile" className="mx-auto">
              {mockup}
            </Mockup>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <Glow variant="above" />
      </div>
    </section>
  );
}
