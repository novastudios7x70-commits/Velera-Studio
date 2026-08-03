import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const mockupVariants = cva("flex relative z-10 overflow-hidden border border-line shadow-2xl", {
  variants: {
    type: {
      mobile: "rounded-[32px] max-w-[280px]",
      responsive: "rounded-2xl",
    },
  },
  defaultVariants: {
    type: "responsive",
  },
});

export interface MockupProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof mockupVariants> {}

const Mockup = React.forwardRef<HTMLDivElement, MockupProps>(({ className, type, ...props }, ref) => (
  <div ref={ref} className={cn(mockupVariants({ type, className }))} {...props} />
));
Mockup.displayName = "Mockup";

export { Mockup };
