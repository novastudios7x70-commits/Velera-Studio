import JSZip from "jszip";
import type { Clip } from "@/lib/database.types";

// Strips characters unsafe in a filename, collapses whitespace, and caps
// length — falls back to "clip" if that leaves nothing usable.
function sanitizeFilenamePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "clip";
}

/**
 * Fetches every clip's rendered file directly from the public clips CDN
 * (never through the Next.js server — see CLAUDE.md) and bundles them into
 * one ZIP the browser saves locally. All-or-nothing by construction: the
 * fetches run in Promise.all, so if any clip is missing a file_url or its
 * fetch fails, the whole call rejects before anything is added to the
 * archive — there's no code path that can produce a partial ZIP. The
 * existing per-clip "downloaded" tracking only fires after the save has
 * actually been triggered, once every clip is confirmed included.
 */
export async function downloadClipsAsZip(clips: Clip[]): Promise<void> {
  if (clips.length === 0) {
    throw new Error("No clips to download.");
  }

  const fetched = await Promise.all(
    clips.map(async (clip) => {
      if (!clip.file_url) {
        throw new Error(`Missing file for "${clip.title ?? clip.id}".`);
      }
      let res: Response;
      try {
        res = await fetch(clip.file_url);
      } catch {
        throw new Error(`Couldn't download "${clip.title ?? clip.id}" (${clip.platform}).`);
      }
      if (!res.ok) {
        throw new Error(`Couldn't download "${clip.title ?? clip.id}" (${clip.platform}).`);
      }
      const blob = await res.blob();
      return { clip, blob };
    }),
  );

  const zip = new JSZip();
  const usedNames = new Map<string, number>();
  for (const { clip, blob } of fetched) {
    const base = `${sanitizeFilenamePart(clip.title ?? "clip")}-${clip.platform}`;
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    const fileName = count === 0 ? `${base}.mp4` : `${base}-${count + 1}.mp4`;
    zip.file(fileName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "velora-clips.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  for (const { clip } of fetched) {
    fetch(`/api/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "downloaded" }),
    }).catch(() => {});
  }
}
