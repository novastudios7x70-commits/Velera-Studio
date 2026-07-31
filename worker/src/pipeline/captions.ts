import type { BeatGrid, TranscriptWord } from "../lib/database.types.js";

interface CaptionCue {
  text: string;
  startSec: number; // relative to the rendered clip, not the source file
  endSec: number;
}

function toAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function nearestBeatAtOrAfter(beats: number[], t: number): number {
  for (const b of beats) if (b >= t) return b;
  return t;
}

/**
 * Word-by-word captions for spoken content — one cue per word, timed to the
 * transcript's own word timestamps, clipped to the segment window.
 */
export function buildWordCues(words: TranscriptWord[], segmentStartSec: number, segmentEndSec: number): CaptionCue[] {
  return words
    .filter((w) => w.start / 1000 >= segmentStartSec && w.end / 1000 <= segmentEndSec)
    .map((w) => ({
      text: w.text,
      startSec: w.start / 1000 - segmentStartSec,
      endSec: w.end / 1000 - segmentStartSec,
    }));
}

/**
 * Music captions: we only have the LLM's single suggested_caption for a
 * segment (no timed lyric input in v1 — see CLAUDE.md), so it's shown as one
 * styled overlay for the clip's duration. When beat-sync is on, its reveal
 * is snapped to the nearest beat instead of appearing at t=0.
 */
export function buildMusicCue(
  caption: string,
  segmentStartSec: number,
  segmentEndSec: number,
  beatGrid: BeatGrid | undefined,
  beatSyncEnabled: boolean,
): CaptionCue[] {
  const duration = segmentEndSec - segmentStartSec;
  let revealAt = 0;
  if (beatSyncEnabled && beatGrid) {
    const relativeBeats = beatGrid.beat_timestamps
      .filter((b) => b >= segmentStartSec && b <= segmentEndSec)
      .map((b) => b - segmentStartSec);
    revealAt = nearestBeatAtOrAfter(relativeBeats, 0.2);
  }
  return [{ text: caption, startSec: revealAt, endSec: duration }];
}

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,72,&H00F2F1F6,&H00F2F1F6,&H00050507,&H99050507,1,0,0,0,100,100,0,0,1,4,0,2,60,60,220,1
Style: Word,DejaVu Sans,84,&H00F2F1F6,&H0014B8B8,&H00050507,&H99050507,1,0,0,0,100,100,0,0,1,5,0,2,60,60,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

/**
 * Builds a full .ass subtitle document. `style` selects the "Word" style
 * (larger, accent-tinted — spoken word-by-word reveals) or "Caption" style
 * (music's single styled overlay).
 */
export function buildAssDocument(cues: CaptionCue[], style: "Word" | "Caption"): string {
  const events = cues
    .map(
      (c) =>
        `Dialogue: 0,${toAssTime(c.startSec)},${toAssTime(c.endSec)},${style},,0,0,0,,${escapeAssText(c.text)}`,
    )
    .join("\n");
  return ASS_HEADER + events + "\n";
}
