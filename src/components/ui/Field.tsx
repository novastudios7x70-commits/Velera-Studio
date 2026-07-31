import type { LucideIcon } from "lucide-react";
import type { InputHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon: LucideIcon;
}

export function Field({ icon: Icon, className, ...props }: FieldProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3.5 bg-panel border border-line">
      <Icon size={15} className="text-muted shrink-0" />
      <input
        {...props}
        className={`w-full bg-transparent outline-none py-3 nova-root text-text text-[13.5px] ${className ?? ""}`}
      />
    </div>
  );
}
