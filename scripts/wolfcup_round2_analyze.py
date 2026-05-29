#!/usr/bin/env python3
"""
Wolf Cup 2025 — Round 2 content analysis (feeds the auto-assembly).

For every Round 2 clip, computes the signals we CAN derive cheaply + reliably:
  - true local shoot-time  (drone filename / Apple creationdate / UTC-4)
  - GPS lat/lon            (phone clips: com.apple.quicktime.location.ISO6709)
  - audio peak loudness    (ffmpeg ebur128 momentary loudness + WHEN it peaks
                            -> the cheer/reaction = the "interesting moment")
  - duration / camera

Then:
  - greedy GPS hole-estimate over the time-ordered phone track (reported, not trusted)
  - drone<->phone time-overlap pairs (matching air/ground = multicam candidates)

Writes round2_analysis.json (consumed by the in-Resolve assembly script).
Read-only on media. No Resolve dependency.
"""
import csv, json, math, os, re, subprocess, sys
from datetime import datetime, timedelta

BASE = r"D:\Wolf-Cup\reference\2025 Playoff Media"
SOURCES = {"Drone": os.path.join(BASE, "Drone"),
           "Seth":  os.path.join(BASE, "Seth Phone"),
           "Josh":  os.path.join(BASE, "iCloud-Josh", "iCloud Photos")}
VID_EXT = (".mp4", ".mov")
R2_START = datetime(2025, 10, 2, 12, 0, 0)
R2_END   = datetime(2025, 10, 2, 18, 0, 0)
EDT = timedelta(hours=4)
DRONE_RE = re.compile(r"DJI_(\d{8})(\d{6})")
ISO6709_RE = re.compile(r"([+-]\d+\.\d+)([+-]\d+\.\d+)")

FFPROBE = (r"C:\Users\jstoll\AppData\Local\Microsoft\WinGet\Packages"
           r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
           r"\ffmpeg-8.0.1-full_build\bin\ffprobe.exe")
FFMPEG = FFPROBE.replace("ffprobe.exe", "ffmpeg.exe")


def probe(path):
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "quiet", "-print_format", "json",
             "-show_entries", "format=duration:format_tags:stream=codec_type",
             "--", path], capture_output=True, text=True, timeout=60)
        return json.loads(out.stdout or "{}").get("format", {}), \
               json.loads(out.stdout or "{}").get("streams", [])
    except Exception:
        return {}, []


def shoot_time(name, tags):
    m = DRONE_RE.search(name)
    if m:
        try:
            return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        except ValueError:
            pass
    cd = tags.get("com.apple.quicktime.creationdate")
    if cd:
        try:
            return datetime.strptime(cd[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
    ct = tags.get("creation_time")
    if ct:
        try:
            return datetime.strptime(ct[:19], "%Y-%m-%dT%H:%M:%S") - EDT
        except ValueError:
            pass
    return None


def gps(tags):
    iso = tags.get("com.apple.quicktime.location.ISO6709")
    if iso:
        m = ISO6709_RE.search(iso)
        if m:
            return float(m.group(1)), float(m.group(2))
    return None, None


def audio_peak(path, has_audio):
    """Return (max_momentary_LUFS, offset_seconds) via ebur128, or (None, None)."""
    if not has_audio:
        return None, None
    try:
        out = subprocess.run(
            [FFMPEG, "-hide_banner", "-nostats", "-i", path,
             "-vn", "-af", "ebur128=peak=none", "-f", "null", "-"],
            capture_output=True, text=True, timeout=180)
        best_m, best_t = -120.0, 0.0
        for line in out.stderr.splitlines():
            mt = re.search(r"t:\s*([\d.]+).*?M:\s*(-?[\d.]+)", line)
            if mt:
                t, mm = float(mt.group(1)), float(mt.group(2))
                if mm > best_m:
                    best_m, best_t = mm, t
        return (best_m if best_m > -120 else None), best_t
    except Exception:
        return None, None


def haversine(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))


def main():
    clips = []
    for cam, folder in SOURCES.items():
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            if not fn.lower().endswith(VID_EXT):
                continue
            path = os.path.join(folder, fn)
            fmt, streams = probe(path)
            tags = fmt.get("tags", {}) or {}
            t = shoot_time(fn, tags)
            if not t or not (R2_START <= t <= R2_END):
                continue
            dur = float(fmt.get("duration", 0) or 0)
            has_audio = any(s.get("codec_type") == "audio" for s in streams)
            lat, lon = gps(tags)
            pk, pkoff = audio_peak(path, has_audio)
            clips.append({"file": fn, "camera": cam, "time": t.strftime("%Y-%m-%d %H:%M:%S"),
                          "epoch": int(t.timestamp()), "dur": round(dur, 2),
                          "lat": lat, "lon": lon, "has_audio": has_audio,
                          "audio_peak_lufs": (round(pk, 1) if pk is not None else None),
                          "peak_offset_s": (round(pkoff, 1) if pk is not None else None)})
            print(f"  {cam:5s} {fn:42s} {t:%H:%M:%S} "
                  f"peak={'%.1f' % pk if pk is not None else '   -'} "
                  f"gps={'Y' if lat else '-'}", flush=True)

    clips.sort(key=lambda c: c["epoch"])

    # interest score: rank phone-clip loudness 0..1 (drone has no audio -> 0, used as B-roll)
    peaks = [c["audio_peak_lufs"] for c in clips if c["audio_peak_lufs"] is not None]
    if peaks:
        lo, hi = min(peaks), max(peaks)
        for c in clips:
            p = c["audio_peak_lufs"]
            c["interest"] = round((p - lo) / (hi - lo), 3) if (p is not None and hi > lo) else 0.0
    else:
        for c in clips:
            c["interest"] = 0.0

    # greedy GPS hole-estimate over time-ordered phone track (reported only)
    THRESH_M = 110.0
    hole = 0
    cent = None
    for c in clips:
        if c["lat"] is None:
            c["gps_hole"] = hole or None
            continue
        p = (c["lat"], c["lon"])
        if cent is None or haversine(cent, p) > THRESH_M:
            hole += 1
            cent = p
        else:
            cent = ((cent[0]*3 + p[0])/4, (cent[1]*3 + p[1])/4)  # slow drift
        c["gps_hole"] = hole

    # drone<->phone time overlap (matching air/ground multicam candidates)
    pairs = []
    drones = [c for c in clips if c["camera"] == "Drone"]
    phones = [c for c in clips if c["camera"] != "Drone"]
    for d in drones:
        d0, d1 = d["epoch"], d["epoch"] + d["dur"]
        for p in phones:
            p0, p1 = p["epoch"], p["epoch"] + p["dur"]
            if d0 < p1 and p0 < d1:  # temporal overlap
                ov = min(d1, p1) - max(d0, p0)
                if ov >= 2:
                    pairs.append({"drone": d["file"], "phone": p["file"],
                                  "overlap_s": round(ov, 1), "phone_interest": p["interest"],
                                  "at": p["time"]})
    pairs.sort(key=lambda x: (-x["phone_interest"], -x["overlap_s"]))

    out = {"clips": clips, "multicam_pairs": pairs,
           "counts": {"clips": len(clips),
                      "drone": len(drones), "phone": len(phones),
                      "with_gps": sum(1 for c in clips if c["lat"]),
                      "with_audio_peak": sum(1 for c in clips if c["audio_peak_lufs"] is not None),
                      "gps_holes_est": hole, "pairs": len(pairs)}}
    with open(os.path.join(BASE, "round2_analysis.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    c = out["counts"]
    print("\n" + "=" * 50)
    print(f"clips={c['clips']}  drone={c['drone']}  phone={c['phone']}")
    print(f"with GPS={c['with_gps']}  with audio-peak={c['with_audio_peak']}")
    print(f"GPS hole-estimate (>{int(THRESH_M)}m jumps): {c['gps_holes_est']} areas")
    print(f"drone<->phone overlap pairs: {c['pairs']}")
    print("Top 8 loudest phone moments (your highlight candidates):")
    for x in sorted([c2 for c2 in clips if c2['audio_peak_lufs'] is not None],
                    key=lambda z: -z['audio_peak_lufs'])[:8]:
        print(f"   {x['time'][11:]}  {x['camera']:4s} {x['file']:40s} "
              f"{x['audio_peak_lufs']} LUFS @ {x['peak_offset_s']}s")
    print("JSON -> round2_analysis.json")


if __name__ == "__main__":
    main()
