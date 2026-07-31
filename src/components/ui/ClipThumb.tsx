import { Play, Wand2 } from "lucide-react";

const PALETTES = [
  ["#14B8A6", "#134E4A"],
  ["#F5A524", "#7C2D12"],
  ["#14B8A6", "#F5A524"],
  ["#312E81", "#0a0a0e"],
  ["#7C3AED", "#1E1B4B"],
];

export function ClipThumb({
  seed,
  generated,
  thumbnailUrl,
  fileUrl,
}: {
  seed: number;
  generated?: boolean;
  thumbnailUrl?: string | null;
  fileUrl?: string | null;
}) {
  const [a, b] = PALETTES[seed % PALETTES.length];

  return (
    <div
      className="relative w-full aspect-[9/16] rounded-xl overflow-hidden flex items-center justify-center"
      style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage CDN image, no build-time optimization needed
        <img src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="nova-noise" />
      )}
      {!thumbnailUrl && (
        <Play size={28} className="text-white/85" fill="currentColor" />
      )}
      {fileUrl && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors"
          aria-label="Preview clip"
        >
          {thumbnailUrl && <Play size={28} className="text-white/85 drop-shadow-lg" fill="currentColor" />}
        </a>
      )}
      {generated && (
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full nova-mono text-[10px] text-text bg-black/50">
          <Wand2 size={10} /> generated
        </div>
      )}
    </div>
  );
}
