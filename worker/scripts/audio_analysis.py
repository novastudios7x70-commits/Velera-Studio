#!/usr/bin/env python3
"""Music energy/mood analysis + optional beat-tracking for Velora Studio.

Invoked by the Node worker (see pipeline/audioAnalysis.ts) as a subprocess:
    python3 audio_analysis.py <audio_path> <with_beat_grid: 0|1>

Prints a single JSON object to stdout:
    {
      "windows": [{"start": s, "end": s, "energy": 0-1, "label": "..."}],
      "beat_grid": {"bpm": float, "beat_timestamps": [s, ...]} | null
    }

Energy windows are 3-second, 50%-overlap RMS-energy frames. The loudest
windows are labeled "chorus" (the strongest candidate for a hook), an early
high-energy jump is labeled "bridge", and everything else is "verse"/"other"
— this is a simple heuristic, not real chorus-detection MIR, and is treated
as such by the segment-selection LLM step downstream (Step 3), which is the
part actually deciding what's hook-worthy.
"""
import json
import sys

import librosa
import numpy as np


def analyze(path: str, with_beat_grid: bool) -> dict:
    y, sr = librosa.load(path, sr=None, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)

    window_s = 3.0
    hop_s = 1.5
    windows = []
    t = 0.0
    frame_energies = []
    while t < duration:
        start_sample = int(t * sr)
        end_sample = int(min(t + window_s, duration) * sr)
        frame = y[start_sample:end_sample]
        if len(frame) == 0:
            break
        rms = float(np.sqrt(np.mean(frame.astype(np.float64) ** 2)))
        frame_energies.append((t, min(t + window_s, duration), rms))
        t += hop_s

    if frame_energies:
        max_rms = max(e[2] for e in frame_energies) or 1e-9
        norm = [(s, e, rms / max_rms) for s, e, rms in frame_energies]

        threshold_high = float(np.percentile([n[2] for n in norm], 80))
        threshold_low = float(np.percentile([n[2] for n in norm], 30))

        seen_high = False
        for start, end, energy in norm:
            if energy >= threshold_high:
                label = "chorus"
            elif not seen_high and energy >= threshold_low:
                label = "bridge"
            elif energy < threshold_low:
                label = "verse"
            else:
                label = "other"
            if energy >= threshold_high:
                seen_high = True
            windows.append({
                "start": round(start, 2),
                "end": round(end, 2),
                "energy": round(energy, 4),
                "label": label,
            })

    beat_grid = None
    if with_beat_grid:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        bpm = float(tempo[0]) if hasattr(tempo, "__len__") else float(tempo)
        beat_grid = {
            "bpm": round(bpm, 2),
            "beat_timestamps": [round(float(b), 3) for b in beat_times],
        }

    return {"windows": windows, "beat_grid": beat_grid}


if __name__ == "__main__":
    audio_path = sys.argv[1]
    want_beats = len(sys.argv) > 2 and sys.argv[2] == "1"
    result = analyze(audio_path, want_beats)
    print(json.dumps(result))
