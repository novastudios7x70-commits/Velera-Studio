export function Switch({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 ease-out outline-none"
      style={{
        background: checked ? "linear-gradient(135deg, var(--violet), #0f766e)" : "var(--line)",
        boxShadow: checked ? "0 0 0 1px rgba(20,184,166,0.5)" : "0 0 0 1px transparent",
      }}
    >
      <span
        className="absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-out"
        style={{
          left: 3,
          transform: checked ? "translateX(18px)" : "translateX(0)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        }}
      />
    </button>
  );
}
