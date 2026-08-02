import type { LucideIcon } from "lucide-react";
import type { InputHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon: LucideIcon;
}

export function Field({ icon: Icon, className, ...props }: FieldProps) {
  // Placeholder text disappears from the accessibility tree once a value is
  // entered (and isn't a real label to begin with), so every Field needs an
  // aria-label — derive one from the placeholder by default rather than
  // requiring every call site to pass it explicitly.
  const ariaLabel = props["aria-label"] ?? (typeof props.placeholder === "string" ? props.placeholder : undefined);
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3.5 bg-panel border border-line">
      <Icon size={15} className="text-muted shrink-0" />
      <input
        {...props}
        aria-label={ariaLabel}
        className={`w-full bg-transparent outline-none py-3 nova-root text-text text-[13.5px] ${className ?? ""}`}
      />
    </div>
  );
}
