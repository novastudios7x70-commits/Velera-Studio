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

// Destructive actions (delete/remove/cancel-with-loss) — same shape as
// PrimaryButton but on the coral accent, so there's one consistent
// "this is dangerous" affordance across the app rather than a one-off
// per feature.
export function DangerButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`nova-btn-danger nova-display font-semibold rounded-xl text-white inline-flex items-center justify-center gap-2 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
