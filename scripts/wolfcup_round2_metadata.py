#!/usr/bin/env python3
"""
Wolf Cup 2025 — Round 2 timeline builder + DaVinci Resolve metadata CSV.

What it does:
  - Scans the three source folders (Drone / Seth Phone / iCloud-Josh).
  - Resolves each clip's TRUE local shoot-time:
        * Drone (DJI_YYYYMMDDHHMMSS...) -> parsed straight from the filename (drone clock = local).
        * Phones (.mov/.mp4)            -> ffprobe:
              prefer com.apple.quicktime.creationdate (local, carries -0400 offset)
              fall back to format creation_time (UTC) - 4h  (EDT, valid Oct 2025).
  - Buckets clips by time:  ROUND 2 (Oct 2, 12:00-18:00) vs everything else (reported, never silently dropped).
  - Clusters the Round 2 clips into segments by idle gap (--gap minutes, default 6).
  - Writes:
        round2_metadata.csv   -> import into Resolve (File Name match; Keywords/Description/Comments).
        round2_timeline.txt    -> human-readable, one line per clip, in shoot order.

Usage:
    python wolfcup_round2_metadata.py [--gap MINUTES]

Nothing is renamed or moved. Read-only on the media; only writes the two output files.
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta

BASE = r"D:\Wolf-Cup\reference\2025 Playoff Media"
SOURCES = {
    "Drone": os.path.join(BASE, "Drone"),
    "Seth":  os.path.join(BASE, "Seth Phone"),
    "Josh":  os.path.join(BASE, "iCloud-Josh", "iCloud Photos"),
}
VID_EXT = (".mp4", ".mov")

# Round 2 = Oct 2, 2025 afternoon. Core play window (local EDT).
R2_START = datetime(2025, 10, 2, 12, 0, 0)
R2_END   = datetime(2025, 10, 2, 18, 0, 0)
EDT_OFFSET = timedelta(hours=4)  # local = UTC - 4 on Oct 2025

DRONE_RE = re.compile(r"DJI_(\d{8})(\d{6})")


def find_ffprobe():
    p = shutil.which("ffprobe")
    if p:
        return p
    guess = os.path.expandvars(
        r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
        r"\ffmpeg-8.0.1-full_build\bin\ffprobe.exe"
    )
    return guess if os.path.exists(guess) else None


FFPROBE = find_ffprobe()


def probe_tags(path):
    """Return (format_tags_dict, duration_seconds) via ffprobe, or ({}, None)."""
    if not FFPROBE:
        return {}, None
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "quiet", "-print_format", "json",
             "-show_entries", "format_tags:format=duration", "--", path],
            capture_output=True, text=True, timeout=60,
        )
        data = json.loads(out.stdout or "{}")
        fmt = data.get("format", {})
        dur = fmt.get("duration")
        return fmt.get("tags", {}) or {}, (float(dur) if dur else None)
    except Exception:
        return {}, None


def local_shoot_time(path, camera):
    """Best available LOCAL shoot time + duration + source-of-time label."""
    name = os.path.basename(path)

    # Drone: filename encodes local time (works even with iCloud UUID prefix).
    m = DRONE_RE.search(name)
    if m:
        try:
            t = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
            _, dur = probe_tags(path)
            return t, dur, "drone-filename"
        except ValueError:
            pass

    tags, dur = probe_tags(path)

    # Phone: Apple local creationdate (carries offset) — take the naive local part.
    cd = tags.get("com.apple.quicktime.creationdate")
    if cd:
        try:
            return datetime.strptime(cd[:19], "%Y-%m-%dT%H:%M:%S"), dur, "apple-creationdate"
        except ValueError:
            pass

    # Fallback: UTC creation_time -> local.
    ct = tags.get("creation_time")
    if ct:
        try:
            utc = datetime.strptime(ct[:19], "%Y-%m-%dT%H:%M:%S")
            return utc - EDT_OFFSET, dur, "utc-minus4"
        except ValueError:
            pass

    return None, dur, "UNKNOWN"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gap", type=float, default=6.0,
                    help="idle minutes that start a new segment (default 6)")
    args = ap.parse_args()

    if not FFPROBE:
        print("WARNING: ffprobe not found — phone-clip times will be UNKNOWN.", file=sys.stderr)

    clips = []
    for camera, folder in SOURCES.items():
        if not os.path.isdir(folder):
            print(f"  (missing folder, skipped: {folder})")
            continue
        for fn in os.listdir(folder):
            if not fn.lower().endswith(VID_EXT):
                continue
            path = os.path.join(folder, fn)
            t, dur, src = local_shoot_time(path, camera)
            clips.append({"camera": camera, "file": fn, "time": t,
                          "dur": dur, "tsrc": src})

    timed = [c for c in clips if c["time"]]
    untimed = [c for c in clips if not c["time"]]
    timed.sort(key=lambda c: c["time"])

    r2     = [c for c in timed if R2_START <= c["time"] <= R2_END]
    before = [c for c in timed if c["time"] < R2_START]   # Oct 1 / Oct 2 morning = Round 1 etc.
    after  = [c for c in timed if c["time"] > R2_END]      # evening / celebration

    # Cluster Round 2 by idle gap.
    seg = 0
    prev = None
    for c in r2:
        if prev is None or (c["time"] - prev).total_seconds() / 60.0 > args.gap:
            seg += 1
        c["seg"] = seg
        prev = c["time"]
    n_seg = seg

    # ---- CSV for DaVinci (File Name match; Keywords/Description/Comments) ----
    csv_path = os.path.join(BASE, "round2_metadata.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["File Name", "Keywords", "Description", "Comments"])
        for c in r2:
            ts = c["time"].strftime("%Y-%m-%d %H:%M:%S")
            w.writerow([
                c["file"],
                f"R2 Seg {c['seg']:02d}",
                f"{c['camera']} @ {c['time'].strftime('%H:%M:%S')}",
                ts,  # sortable in Resolve -> true timeline order across all 3 cameras
            ])

    # ---- Human-readable timeline ----
    txt_path = os.path.join(BASE, "round2_timeline.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("WOLF CUP 2025 — ROUND 2 TIMELINE  (Oct 2, 12:00-18:00 local)\n")
        f.write(f"gap threshold = {args.gap} min  ->  {n_seg} segments\n")
        f.write("=" * 72 + "\n")
        prev = None
        for c in r2:
            gap = "" if prev is None else f"  (+{int((c['time']-prev).total_seconds()//60)}m)"
            if prev is None or c["seg"] != getattr(c, "_p", None):
                pass
            f.write(f"Seg{c['seg']:02d}  {c['time'].strftime('%H:%M:%S')}  "
                    f"{c['camera']:5s}  {c['file']}{gap}\n")
            prev = c["time"]
        f.write("\n--- OUTSIDE ROUND 2 (not in CSV) ---\n")
        for label, group in (("BEFORE 12:00 (Round 1 / morning)", before),
                             ("AFTER 18:00 (evening / post-round)", after)):
            f.write(f"\n[{label}]  {len(group)} clips\n")
            for c in group:
                f.write(f"   {c['time'].strftime('%m-%d %H:%M:%S')}  {c['camera']:5s}  {c['file']}\n")
        if untimed:
            f.write(f"\n[NO TIMESTAMP RESOLVED]  {len(untimed)} clips\n")
            for c in untimed:
                f.write(f"   {c['camera']:5s}  {c['file']}  (tsrc={c['tsrc']})\n")

    # ---- Console summary ----
    by_cam = lambda lst: ", ".join(f"{cam}:{sum(1 for c in lst if c['camera']==cam)}"
                                    for cam in SOURCES)
    print(f"ffprobe: {FFPROBE}")
    print(f"Total video files scanned : {len(clips)}")
    print(f"  timestamp resolved      : {len(timed)}   (unresolved: {len(untimed)})")
    print(f"ROUND 2  (12:00-18:00)    : {len(r2)} clips   [{by_cam(r2)}]")
    if r2:
        print(f"  span                    : {r2[0]['time']:%H:%M:%S} -> {r2[-1]['time']:%H:%M:%S}")
        print(f"  segments (gap {args.gap}m)    : {n_seg}")
    print(f"  before 12:00 (Round 1?) : {len(before)} clips  [{by_cam(before)}]")
    print(f"  after 18:00 (evening)   : {len(after)} clips  [{by_cam(after)}]")
    print()
    print(f"CSV  -> {csv_path}")
    print(f"TXT  -> {txt_path}")


if __name__ == "__main__":
    main()
