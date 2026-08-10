import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const glowVariants = cva("absolute w-full pointer-events-none", {
  variants: {
    variant: {
      top: "top-0",
      above: "-top-[128px]",
      bottom: "bottom-0",
      below: "-bottom-[128px]",
      center: "top-[50%]",
    },
  },
  defaultVariants: {
    variant: "top",
  },
});

// Reuses this app's existing radial-glow treatment (see .nova-pulse-glow)
// rather than shadcn's default hsl-var-based gradient, since this project's
// color tokens are plain hex/rgba, not bare HSL components.
const Glow = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof glowVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(glowVariants({ variant }), className)} {...props}>
    <div
      className={cn(
        "absolute left-1/2 h-[300px] w-[60%] -translate-x-1/2 scale-[2] rounded-[50%] sm:h-[500px]",
        variant === "center" && "-translate-y-1/2",
      )}
      style={{ background: "radial-gradient(ellipse at center, var(--gold-soft), transparent 65%)", filter: "blur(20px)" }}
    />
  </div>
));
Glow.displayName = "Glow";

export { Glow };
