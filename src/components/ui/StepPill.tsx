import { Check } from "lucide-react";

export function StepPill({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center nova-mono font-medium shrink-0 text-[11px]"
        style={{
          background: done ? "var(--violet)" : active ? "var(--violet-soft)" : "transparent",
          border: `1px solid ${done || active ? "var(--violet)" : "var(--line)"}`,
          color: done ? "#fff" : active ? "var(--violet)" : "var(--muted)",
        }}
      >
        {done ? <Check size={12} /> : n}
      </div>
      <span className={`text-[13px] ${active || done ? "text-text" : "text-muted"}`}>{label}</span>
    </div>
  );
}
