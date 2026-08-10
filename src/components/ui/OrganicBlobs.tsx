/**
 * Organic liquid-blob decoration, in the spirit of noth.in's amoeba-like
 * metaball shapes — built with pure CSS border-radius morphing (no canvas,
 * no new dependency) rather than a true metaball simulation, since a soft
 * blurred wash reads the same at this scale and keeps the motion light.
 */
export function OrganicBlobs({ className }: { className?: string }) {
  return (
    <div className={className} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        className="nova-blob nova-blob-a"
        style={{
          position: "absolute",
          top: "-10%",
          left: "5%",
          width: "50%",
          maxWidth: 520,
          aspectRatio: "1 / 1",
          background: "radial-gradient(circle at 35% 35%, var(--gold), transparent 72%)", // gold
          filter: "blur(50px)",
          opacity: 0.5,
        }}
      />
      <div
        className="nova-blob nova-blob-b"
        style={{
          position: "absolute",
          top: "15%",
          right: "0%",
          width: "38%",
          maxWidth: 420,
          aspectRatio: "1 / 1",
          background: "radial-gradient(circle at 60% 40%, var(--plum), transparent 70%)", // plum, rare secondary
          filter: "blur(45px)",
          opacity: 0.45,
        }}
      />
      <div
        className="nova-blob nova-blob-c"
        style={{
          position: "absolute",
          bottom: "-15%",
          left: "30%",
          width: "34%",
          maxWidth: 380,
          aspectRatio: "1 / 1",
          background: "radial-gradient(circle at 45% 55%, #dbb44a, transparent 75%)", // secondary gold tone
          filter: "blur(55px)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}
