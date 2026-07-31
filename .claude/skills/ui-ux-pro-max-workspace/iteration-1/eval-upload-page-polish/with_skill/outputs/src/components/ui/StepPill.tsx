import { Check } from "lucide-react";

export function StepPill({
  n,
  label,
  active,
  done,
  onClick,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
  /** When provided, the pill becomes clickable (e.g. "jump back to this step"). */
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-label={clickable ? `Back to ${label}` : undefined}
      className={`group flex items-center gap-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/40 ${
        clickable ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center nova-mono font-medium shrink-0 text-[11px] transition-colors"
        style={{
          background: done ? "var(--violet)" : active ? "var(--violet-soft)" : "transparent",
          border: `1px solid ${done || active ? "var(--violet)" : "var(--line)"}`,
          color: done ? "#fff" : active ? "var(--violet)" : "var(--muted)",
        }}
      >
        {done ? <Check size={12} /> : n}
      </div>
      <span
        className={`text-[13px] transition-colors ${active || done ? "text-text" : "text-muted"} ${
          clickable ? "group-hover:text-violet" : ""
        }`}
      >
        {label}
      </span>
    </button>
  );
}
