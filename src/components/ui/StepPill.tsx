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
          background: done ? "var(--text)" : active ? "var(--gold-soft)" : "transparent",
          border: `1px solid ${done ? "var(--text)" : active ? "var(--gold)" : "var(--line)"}`,
          color: done ? "var(--ink)" : active ? "var(--gold)" : "var(--muted)",
        }}
      >
        {done ? <Check size={12} /> : n}
      </div>
      <span className={`text-[13px] ${active || done ? "text-text" : "text-muted"}`}>{label}</span>
    </div>
  );
}
