#!/usr/bin/env python3
"""Detect tempo + beat grid for the Wolf Cup music tracks -> beats.json."""
import json, os, librosa, numpy as np

MUSIC = r"D:\Wolf-Cup\reference\2025 Playoff Media\Music"
TRACKS = {
    "light":    "lightbeatsmusic-joyful-rhythm-walk-funk-513936.mp3",
    "carnaval": "alec_koff-carnaval-484622.mp3",
    "fassounds":"fassounds-escape-your-love-upbeat-fashion-pop-dance-412230.mp3",
    "dance":    "alexzavesa-dance-playful-night-510786.mp3",
}
out = {}
for key, fn in TRACKS.items():
    path = os.path.join(MUSIC, fn)
    if not os.path.exists(path):
        print(f"  MISSING {fn}"); continue
    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    tempo = float(np.atleast_1d(tempo)[0])
    dur = float(librosa.get_duration(y=y, sr=sr))
    # first strong onset = where to start so a "drop" lands well
    onset = librosa.onset.onset_detect(y=y, sr=sr, units="time")
    out[key] = {"file": fn, "bpm": round(float(tempo), 1), "dur": round(dur, 2),
                "n_beats": len(beats),
                "first_beat": round(float(beats[0]), 3) if len(beats) else 0.0,
                "first_onset": round(float(onset[0]), 3) if len(onset) else 0.0,
                "beats": [round(float(b), 3) for b in beats]}
    print(f"  {key:9s} {out[key]['bpm']:6.1f} BPM  {dur:6.1f}s  "
          f"{len(beats)} beats  first_beat={out[key]['first_beat']}s")

with open(os.path.join(MUSIC, "beats.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
print("-> Music\\beats.json")
