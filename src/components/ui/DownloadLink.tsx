"use client";

import { Download } from "lucide-react";

export function DownloadLink({ clipId, url, label }: { clipId: string; url: string; label: string }) {
  const handleClick = () => {
    fetch(`/api/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "downloaded" }),
    }).catch(() => {});
  };

  return (
    <a
      href={url}
      download
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className="flex items-center justify-center gap-1.5 rounded-lg py-2 border border-line text-text text-[12px] hover:border-violet/50 transition-colors"
    >
      <Download size={12} /> {label}
    </a>
  );
}
