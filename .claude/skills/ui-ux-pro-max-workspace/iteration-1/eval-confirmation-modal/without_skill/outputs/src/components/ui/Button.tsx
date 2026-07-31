import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export function PrimaryButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`nova-btn-primary nova-display font-semibold rounded-xl text-white inline-flex items-center justify-center gap-2 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export const DangerButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function DangerButton({ className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        {...props}
        className={`nova-btn-danger nova-display font-semibold rounded-xl text-white inline-flex items-center justify-center gap-2 ${className ?? ""}`}
      >
        {children}
      </button>
    );
  },
);

export function GhostButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`border border-line rounded-xl text-text inline-flex items-center justify-center gap-2 transition-colors hover:border-violet/50 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
