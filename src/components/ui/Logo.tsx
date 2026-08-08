import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center nova-display font-bold text-[14px] text-white"
        style={{ background: "linear-gradient(135deg, #D6127A, #65A30D)" }}
      >
        V
      </div>
      <span className="nova-display font-semibold tracking-wide text-[16px] text-text">
        VELORA <span className="text-muted font-medium">STUDIO</span>
      </span>
    </Link>
  );
}
