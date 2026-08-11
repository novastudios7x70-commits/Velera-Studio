import type { ButtonHTMLAttributes } from "react";

export function PrimaryButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`nova-btn-primary nova-display font-semibold rounded-lg inline-flex items-center justify-center gap-2 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`border border-line rounded-lg text-text inline-flex items-center justify-center gap-2 transition-colors hover:border-white/20 hover:bg-white/[0.03] ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
