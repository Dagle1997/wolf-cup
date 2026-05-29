# Wolf Cup 2025 — Round 2 three-act music cut (LONGER clips, gapless, NO beat-sync).
# Run from Resolve's Console (Py3):
#   exec(open(r"D:\Wolf-Cup\scripts\build_round2_music_cut.py").read())
#
# Same longer-clip timing as the first rough cut (clips run back-to-back, no black gaps),
# with the three-act music laid underneath on A2 (pre-baked quieter so dialogue/cheers win):
#   Act 1 intro  -> light_bed (-18dB)         welfare + interviews + walkup montage
#   Act 2 course -> carnaval_q then fassounds_q (-9dB)   highlights + drone B-roll
#   Act 3 finish -> dance_q (-9dB)            the 5:15+ celebration
# Clip/cheer/interview audio stays on A1. Non-destructive new timeline.

import json, os

BASE  = r"D:\Wolf-Cup\reference\2025 Playoff Media"
MUSIC = os.path.join(BASE, "Music")
TL_NAME = "WC2025 R2 - Music Cut"
TL_FPS = 30

# --- clip timing (the longer "first cut" feel Josh preferred) ---
PRE_PEAK, POST_PEAK = 4.0, 6.0     # ~10s highlights, peak ~40% in
DRONE_LEN = 5.0
DRONE_EVERY = 2
N_HIGHLIGHTS = 28
FINISH_CUTOFF = "2025-10-02 17:15:00"
CARNAVAL_LEADIN_SLOTS = 6          # first N act-2 slots over Carnaval, rest fassounds
# Bad footage to keep out (case-insensitive PREFIX match; no extension needed).
EXCLUDE = {"img_1558", "img_1559", "img_6607", "img_6620", "dji_20251002151505_0162"}

WELFARE = ("Moses-Welfare Check.mov", "Moses welfare check (kidney stone)", 0.0, 28.0)
INTERVIEWS = [
    ("IMG_6603.MOV", "Interview: Matt Jaquint (6603)",  57.9 - 6, 57.9 + 9),
    ("IMG_6605.MOV", "Interview: Jason Moses (6605)",    111.1 - 6, 111.1 + 9),
    ("IMG_6606.MOV", "Interview: Jay Patterson (6606)",  49.3 - 6, 49.3 + 9),
    ("IMG_6608.MOV", "Interview: Michael Bonner (6608)", 146.9 - 8, 146.9 + 4),
]
MONTAGE = ("IMG_6610.MOV", "Walkup intros (6610) 2nd half - all 4 golfers", 54.0, 104.0)
WELFARE_SRC = os.path.join(BASE, "Pre-Round", "Moses-Welfare Check.mov")
INTRO_FILES = {WELFARE[0]} | {i[0] for i in INTERVIEWS} | {MONTAGE[0]}

# baked quieter music; timing (first_beat/dur) read from beats.json originals
ACT_TRACKS = {"light": "light_bed.mp3", "carnaval": "carnaval_q.mp3",
              "fassounds": "fassounds_q.mp3", "dance": "dance_q.mp3"}

try:
    resolve
except NameError:
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")
proj = resolve.GetProjectManager().GetCurrentProject()
mp   = proj.GetMediaPool()

clips = json.load(open(os.path.join(BASE, "round2_analysis.json"), encoding="utf-8"))["clips"]
beats = json.load(open(os.path.join(MUSIC, "beats.json"), encoding="utf-8"))
by_file = {c["file"]: c for c in clips}

pool = {}
def index_item(it):
    pool[it.GetName()] = it
    fn = it.GetClipProperty("File Name")
    if fn: pool[os.path.basename(fn)] = it
def walk(folder):
    items = list(folder.GetClipList())
    for s in folder.GetSubFolderList(): items += walk(s)
    return items
for it in walk(mp.GetRootFolder()): index_item(it)

for path in [WELFARE_SRC] + [os.path.join(MUSIC, f) for f in ACT_TRACKS.values()]:
    if os.path.basename(path) not in pool and os.path.exists(path):
        for it in (mp.ImportMedia([path]) or []): index_item(it)

def item_for(name): return pool.get(name)
def fps_of(it):
    try: return round(float(it.GetClipProperty("FPS") or TL_FPS))
    except Exception: return TL_FPS
def frames_of(it):
    try: return int(it.GetClipProperty("Frames") or 0)
    except Exception: return 10**9
def music_item(key): return item_for(os.path.basename(ACT_TRACKS[key]))
def excluded(name):
    n = name.lower()
    return any(n.startswith(t) for t in EXCLUDE)

def delete_timeline(name):
    for i in range(proj.GetTimelineCount(), 0, -1):
        t = proj.GetTimelineByIndex(i)
        if t and t.GetName() == name: mp.DeleteTimelines([t])

delete_timeline(TL_NAME)
tl = mp.CreateEmptyTimeline(TL_NAME)
proj.SetCurrentTimeline(tl)
tl.AddTrack("audio", "stereo")          # A2 = music
base = tl.GetStartFrame()
markers = []

def entry_hl(c, kind):
    it = item_for(c["file"])
    if not it: return None
    cfps, tf = fps_of(it), frames_of(it)
    if kind == "DR":
        s = int(max(0, c["dur"] * 0.3) * cfps); e = min(tf - 1, s + int(DRONE_LEN * cfps))
        label = None
    else:
        pk = c.get("peak_offset_s") or 0
        s = int(max(0, pk - PRE_PEAK) * cfps); e = min(tf - 1, s + int((PRE_PEAK + POST_PEAK) * cfps))
        label = ("Yellow", f"{c['time'][11:16]} {c['file']} {c['audio_peak_lufs']}LUFS")
    return {"it": it, "s": s, "e": e, "label": label}

def entry_intro(fname, label, s_s, e_s):
    it = item_for(fname)
    if not it: print("  intro clip missing:", fname); return None
    cfps, tf = fps_of(it), frames_of(it)
    s = int(max(0, s_s) * cfps); e = min(tf - 1, int(e_s * cfps))
    return {"it": it, "s": s, "e": e, "label": ("Cyan", label)}

cursor = 0
def append_act(entries):
    """Append entries back-to-back on V1 (with their audio on A1). Returns segment frames."""
    global cursor
    entries = [x for x in entries if x]
    items = mp.AppendToTimeline([{ "mediaPoolItem": x["it"], "startFrame": x["s"],
                                   "endFrame": x["e"] } for x in entries]) or []
    off = cursor
    for x, ti in zip(entries, items):
        if x["label"]:
            markers.append((off, x["label"][0], x["label"][1]))
        off += ti.GetDuration()
    seg = off - cursor
    cursor = off
    return seg

def place_music(key, rec_off, length):
    it = music_item(key)
    if not it or length <= 0: return
    fb = int(beats[key]["first_beat"] * TL_FPS)
    avail = int(beats[key]["dur"] * TL_FPS) - fb
    L = min(length, max(1, avail))
    mp.AppendToTimeline([{ "mediaPoolItem": it, "startFrame": fb, "endFrame": fb + L,
                           "recordFrame": base + rec_off, "trackIndex": 2, "mediaType": 2 }])
    if L < length - TL_FPS:
        print(f"  note: {key} music {L/TL_FPS:.0f}s < segment {length/TL_FPS:.0f}s (silent tail)")

# selections
phone = [c for c in clips if c["camera"] != "Drone" and c.get("audio_peak_lufs") is not None
         and not excluded(c["file"]) and c["file"] not in INTRO_FILES]
drone = [c for c in clips if c["camera"] == "Drone" and not excluded(c["file"])]
loud = sorted(phone, key=lambda c: -c["audio_peak_lufs"])[:N_HIGHLIGHTS]
act2_h = sorted([c for c in loud if c["time"] < FINISH_CUTOFF], key=lambda c: c["epoch"])
act3_h = sorted([c for c in loud if c["time"] >= FINISH_CUTOFF], key=lambda c: c["epoch"])

used_drone = set()
def nearest_drone(epoch):
    cand = [d for d in drone if d["file"] not in used_drone]
    return min(cand, key=lambda d: abs(d["epoch"] - epoch)) if cand else None
def slots(highlights):
    out = []
    for i, c in enumerate(highlights):
        if i % DRONE_EVERY == 0:
            dr = nearest_drone(c["epoch"])
            if dr: used_drone.add(dr["file"]); out.append(entry_hl(dr, "DR"))
        out.append(entry_hl(c, "HL"))
    return out

# ACT 1 — intro + light bed
s1 = cursor; seg = append_act([entry_intro(*WELFARE)] +
                              [entry_intro(*iv) for iv in INTERVIEWS] +
                              [entry_intro(*MONTAGE)])
place_music("light", s1, seg)

# ACT 2 — carnaval lead-in -> fassounds body
s2 = slots(act2_h)
sa = cursor; seg = append_act(s2[:CARNAVAL_LEADIN_SLOTS]); place_music("carnaval", sa, seg)
sb = cursor; seg = append_act(s2[CARNAVAL_LEADIN_SLOTS:]); place_music("fassounds", sb, seg)

# ACT 3 — finish + dance
s3v = cursor; seg = append_act(slots(act3_h)); place_music("dance", s3v, seg)

for off, color, label in markers:
    tl.AddMarker(off, color, label, label, 1)

print("=" * 56)
print(f"Timeline: {TL_NAME}   total ~{int(cursor/TL_FPS//60)}m{int(cursor/TL_FPS%60)}s")
print(f"  Act1 intro : ends {s2 and ''}{int(sa/TL_FPS)}s  (light_bed)")
print(f"  Act2 course: {len(s2)} slots, ends {int(s3v/TL_FPS)}s  (carnaval -> fassounds)")
print(f"  Act3 finish: {len(act3_h)} HL, ends {int(cursor/TL_FPS)}s  (dance)")
print(f"  markers {len(markers)}.  Music on A2 (baked -9/-18dB), clip audio on A1.")
print("=" * 56)
