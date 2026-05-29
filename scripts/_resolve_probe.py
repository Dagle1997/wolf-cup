# Wolf Cup — in-process API smoke test. Run from Resolve's Console (Python3):
#   exec(open(r"D:\Wolf-Cup\scripts\_resolve_probe.py").read())
try:
    resolve  # the Console pre-injects this global
except NameError:
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")

proj = resolve.GetProjectManager().GetCurrentProject()
root = proj.GetMediaPool().GetRootFolder()

def count_clips(folder):
    n = len(folder.GetClipList())
    for sub in folder.GetSubFolderList():
        n += count_clips(sub)
    return n

print("=" * 40)
print("PROJECT  :", proj.GetName())
print("CLIPS    :", count_clips(root))
print("FOLDERS  :", [f.GetName() for f in root.GetSubFolderList()])
print("TIMELINES:", proj.GetTimelineCount())
print("API OK — in-process scripting works.")
print("=" * 40)
