# Wolf Cup 2025 — Round 2 AI rough-cut + air/ground sync builder.
# Run from Resolve's Console (Py3):
#   exec(open(r"D:\Wolf-Cup\scripts\build_round2_cut.py").read())
#
# Builds TWO new timelines (non-destructive):
#  1) "WC2025 R2 - AI Rough Cut"
#       - interview intro: ~15s around the funniest (loudest) moment of each
#         Final-Four pre-round interview
#       - top loud highlights in time order, trimmed around each cheer
#       - drone B-roll interleaved
#       - yellow markers at every beat
#  2) "WC2025 R2 - Air+Ground Sync"
#       - matched drone+phone pairs stacked on V2/V1, aligned by shoot-time
#         (~1s sync; nudge to frame on impact, or make a Multicam in the GUI)

import json, os

BASE = r"D:\Wolf-Cup\reference\2025 Playoff Media"
RC_NAME   = "WC2025 R2 - AI Rough Cut"
SYNC_NAME = "WC2025 R2 - Air+Ground Sync"

# --- tunables ---
# Explicit intro plan (Josh-confirmed content). (file, label, start_s, end_s)
# end_s = None means trim to a ~15s window around the clip's funny audio peak.
WELFARE = ("Moses-Welfare Check.mov", "Moses welfare check (kidney stone)", 0.0, 28.0)
INTERVIEWS = [
    ("IMG_6603.MOV", "Interview: Matt Jaquint (6603)",   57.9 - 6, 57.9 + 9),
    ("IMG_6605.MOV", "Interview: Jason Moses (6605)",    111.1 - 6, 111.1 + 9),
    ("IMG_6606.MOV", "Interview: Jay Patterson (6606)",       49.3 - 6, 49.3 + 9),
    ("IMG_6608.MOV", "Interview: Michael Bonner (6608)",      146.9 - 8, 146.9 + 4),
]
MONTAGE = ("IMG_6610.MOV", "Walkup music + golfer intros (6610)", 38.0, 66.0)
WELFARE_SRC = r"D:\Wolf-Cup\reference\2025 Playoff Media\Pre-Round\Moses-Welfare Check.mov"
INTRO_FILES = {WELFARE[0]} | {i[0] for i in INTERVIEWS} | {MONTAGE[0]}
N_HIGHLIGHTS   = 24
PRE_PEAK_S, POST_PEAK_S = 4.0, 6.0
DRONE_EVERY    = 2
DRONE_LEN_S    = 5.0
N_PAIRS        = 12
PAIR_MIN_OVERLAP = 3.0
TL_FPS = 30
# Bad footage to keep out of highlights AND sync pairs (case-insensitive). Add duds here.
EXCLUDE = {"img_1558.mov", "img_1559.mov"}

try:
    resolve
except NameError:
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")

proj = resolve.GetProjectManager().GetCurrentProject()
mp   = proj.GetMediaPool()

data  = json.load(open(os.path.join(BASE, "round2_analysis.json"), encoding="utf-8"))
clips = data["clips"]
by_file = {c["file"]: c for c in clips}

def walk(folder):
    items = list(folder.GetClipList())
    for sub in folder.GetSubFolderList():
        items += walk(sub)
    return items
pool = {}
def index_item(it):
    pool[it.GetName()] = it
    fn = it.GetClipProperty("File Name")
    if fn:
        pool[os.path.basename(fn)] = it
for it in walk(mp.GetRootFolder()):
    index_item(it)

# make sure the welfare-check clip is in the pool (import it if it isn't)
if WELFARE[0] not in pool and os.path.exists(WELFARE_SRC):
    for it in (mp.ImportMedia([WELFARE_SRC]) or []):
        index_item(it)

def delete_timeline(name):
    for i in range(proj.GetTimelineCount(), 0, -1):
        tl = proj.GetTimelineByIndex(i)
        if tl and tl.GetName() == name:
            mp.DeleteTimelines([tl])

def item_for(name): return pool.get(name)
def fps_of(it):
    try: return round(float(it.GetClipProperty("FPS") or TL_FPS))
    except Exception: return TL_FPS
def frames_of(it):
    try: return int(it.GetClipProperty("Frames") or 0)
    except Exception: return 0
def sub_io(it, start_s, end_s):
    fps = fps_of(it); tf = frames_of(it) or int((end_s + 5) * fps)
    s = max(0, int(start_s * fps)); e = min(tf - 1, int(end_s * fps))
    if e <= s: e = min(tf - 1, s + int(2 * fps))
    return s, e

phone = [c for c in clips if c["camera"] != "Drone" and c.get("audio_peak_lufs") is not None
         and c["file"].lower() not in EXCLUDE]
drone = [c for c in clips if c["camera"] == "Drone" and c["file"].lower() not in EXCLUDE]

# ---------- TIMELINE 1: rough cut ----------
loud = sorted([c for c in phone if c["file"] not in INTRO_FILES],
              key=lambda c: -c["audio_peak_lufs"])[:N_HIGHLIGHTS]
highlights = sorted(loud, key=lambda c: c["epoch"])

edit, markers, used_drone, running = [], [], set(), 0
def add(it, s_s, e_s, kind, label):
    global running
    s, e = sub_io(it, s_s, e_s)
    edit.append({"mediaPoolItem": it, "startFrame": s, "endFrame": e})
    if kind in ("HL", "IV"):
        markers.append((running, kind, label))
    running += (e - s) + 1

intro_plan = [WELFARE] + INTERVIEWS + [MONTAGE]
intro_used = []
for fname, label, s_s, e_s in intro_plan:
    it = item_for(fname)
    if it:
        add(it, max(0, s_s), e_s, "IV", label)
        intro_used.append(label)
    else:
        print("  (intro clip not in pool, skipped:", fname, ")")

def nearest_drone(epoch):
    cand = [d for d in drone if d["file"] not in used_drone]
    return min(cand, key=lambda d: abs(d["epoch"] - epoch)) if cand else None

for i, c in enumerate(highlights):
    if i % DRONE_EVERY == 0:
        dr = nearest_drone(c["epoch"])
        if dr:
            dit = item_for(dr["file"])
            if dit:
                used_drone.add(dr["file"])
                st = max(0, dr["dur"] * 0.3)
                add(dit, st, st + DRONE_LEN_S, "DR", dr["file"])
    it = item_for(c["file"])
    if it:
        pk = c["peak_offset_s"] or 0
        add(it, max(0, pk - PRE_PEAK_S), pk + POST_PEAK_S, "HL",
            f"{c['time'][11:16]} {c['file']} {c['audio_peak_lufs']}LUFS")

delete_timeline(RC_NAME)
rc = mp.CreateEmptyTimeline(RC_NAME)
proj.SetCurrentTimeline(rc)
mp.AppendToTimeline(edit)
for frame, kind, label in markers:
    rc.AddMarker(frame, "Cyan" if kind == "IV" else "Yellow", label, label, 1)

# ---------- TIMELINE 2: air/ground sync ----------
pairs = [p for p in data["multicam_pairs"] if p["overlap_s"] >= PAIR_MIN_OVERLAP
         and p["phone"].lower() not in EXCLUDE and p["drone"].lower() not in EXCLUDE][:N_PAIRS]
delete_timeline(SYNC_NAME)
sync = mp.CreateEmptyTimeline(SYNC_NAME)
sync.AddTrack("video")               # V2
proj.SetCurrentTimeline(sync)
base = sync.GetStartFrame()
cursor, pair_marks, built = 0, [], 0
for p in pairs:
    pc, dc = by_file.get(p["phone"]), by_file.get(p["drone"])
    pit, dit = item_for(p["phone"]), item_for(p["drone"])
    if not (pc and dc and pit and dit):
        continue
    ov0 = max(pc["epoch"], dc["epoch"])
    ov1 = min(pc["epoch"] + pc["dur"], dc["epoch"] + dc["dur"])
    if ov1 - ov0 < PAIR_MIN_OVERLAP:
        continue
    pfps, dfps = fps_of(pit), fps_of(dit)
    p_in, p_out = int((ov0 - pc["epoch"]) * pfps), int((ov1 - pc["epoch"]) * pfps)
    d_in, d_out = int((ov0 - dc["epoch"]) * dfps), int((ov1 - dc["epoch"]) * dfps)
    rec = base + cursor
    okp = mp.AppendToTimeline([{ "mediaPoolItem": pit, "startFrame": p_in, "endFrame": p_out,
                                 "recordFrame": rec, "trackIndex": 1, "mediaType": 1 }])
    okd = mp.AppendToTimeline([{ "mediaPoolItem": dit, "startFrame": d_in, "endFrame": d_out,
                                 "recordFrame": rec, "trackIndex": 2, "mediaType": 1 }])
    if okp and okd:
        pair_marks.append((cursor, f"{p['at'][11:16]}  V1:{p['phone']}  V2:{p['drone']}"))
        cursor += int((ov1 - ov0) * TL_FPS) + 60
        built += 1

for off, label in pair_marks:
    sync.AddMarker(off, "Green", label, label, 1)

print("=" * 54)
print(f"[1] {RC_NAME}")
print(f"    intro {len(intro_used)}, highlights {len(highlights)}, "
      f"drone {len(used_drone)}, markers {len(markers)}, ~{int(running/TL_FPS//60)}m{int(running/TL_FPS%60)}s")
for lbl in intro_used:
    print("      intro:", lbl)
print(f"[2] {SYNC_NAME}")
print(f"    synced air/ground pairs built: {built}")
print("Switch to Edit page. Both timelines are in the pool.")
print("=" * 54)
