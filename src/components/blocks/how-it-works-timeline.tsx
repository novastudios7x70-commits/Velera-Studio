import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/shadcn/badge";

/**
 * Adapted from 21st.dev's "How It Works Timeline" (7ovr/how-it-works-2).
 * Differs from the original registry version: uses lucide-react icons
 * (already a dependency here) instead of adding @remixicon/react, takes
 * steps as a prop instead of hardcoded copy, and the icon circle uses this
 * app's soft-tint treatment instead of shadcn's plain bg-muted fill.
 */
interface Step {
  icon: LucideIcon;
  title: string;
  copy: string;
}

interface HowItWorksTimelineProps {
  eyebrow: string;
  title: string;
  description: string;
  steps: Step[];
}

export function HowItWorksTimeline({ eyebrow, title, description, steps }: HowItWorksTimelineProps) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-20 w-full">
      <div className="mb-12 text-center">
        <Badge variant="outline" className="mb-4">
          {eyebrow}
        </Badge>
        <h2 className="nova-display font-semibold text-[28px] text-text tracking-[-0.01em]">{title}</h2>
        <p className="mt-2 text-muted text-[14.5px]">{description}</p>
      </div>

      <ol className="flex flex-col">
        {steps.map(({ icon: Icon, title: stepTitle, copy }, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={stepTitle} className="flex gap-5">
              <div className="flex flex-col items-center">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-gold-soft">
                  <Icon className="size-4 text-gold" aria-hidden="true" />
                </span>
                {!isLast && <span className="mt-1 w-px flex-1 bg-line" />}
              </div>

              <div className={isLast ? "pb-0" : "pb-9"}>
                <div className="nova-mono text-[10px] text-muted mb-1">STEP {index + 1}</div>
                <h3 className="nova-display font-medium text-[15px] text-text">{stepTitle}</h3>
                <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{copy}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
