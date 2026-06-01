#!/usr/bin/env python3
"""Generic: dump WEEK / date / Side Game / TEES sequence across columns for any season xlsm.
Auto-finds the sheet containing a col-E 'TEES' label and the label rows."""
import sys, zipfile, xml.etree.ElementTree as ET
NS = {"ss": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
def col_to_num(col):
    n=0
    for c in col: n=n*26+(ord(c)-ord("A")+1)
    return n
def num_to_col(n):
    s=""
    while n>0:
        n,r=divmod(n-1,26); s=chr(65+r)+s
    return s
def parse_ref(ref):
    col="";row=""
    for c in ref:
        if c.isalpha(): col+=c
        else: row+=c
    return col,int(row)

path=sys.argv[1]
with zipfile.ZipFile(path) as z:
    ssr=ET.parse(z.open("xl/sharedStrings.xml")).getroot()
    shared=["".join(t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")) for si in ssr.findall("ss:si",NS)]
    sheets=[n for n in z.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
    def build(name):
        root=ET.parse(z.open(name)).getroot()
        cm={}
        for row_el in root.findall(".//ss:row",NS):
            ri=int(row_el.get("r"))
            for c in row_el.findall("ss:c",NS):
                ref=c.get("r","");t=c.get("t","");v=c.find("ss:v",NS)
                if v is not None and v.text:
                    cs,_=parse_ref(ref);ci=col_to_num(cs)
                    cm[(ri,ci)] = shared[int(v.text)] if t=="s" else v.text
        return cm
    maps={name:build(name) for name in sheets}

COL_E=col_to_num("E")
# find sheet + rows for labels
target=None;rows={}
for name,cm in maps.items():
    found={}
    for (r,ci),val in cm.items():
        if ci==COL_E and isinstance(val,str):
            v=val.strip()
            if v in ("WEEK","Week"): found.setdefault("week",r)
            if v in ("Side Game","Side game"): found.setdefault("game",r)
            if v in ("TEES","Tees"): found.setdefault("tee",r)
            if v in ("Winner",): found.setdefault("winner",r)
    if "tee" in found and "week" in found:
        target=name;rows=found;break
print(f"FILE: {path}")
print(f"  sheet={target}  label rows={rows}")
cm=maps[target]
wr=rows.get("week");gr=rows.get("game");tr=rows.get("tee");dr=rows.get("week")  # date often in week row+? we print week-row text as it holds date in 2025? no.
# In 2025: row1=week#, row2(WEEK label)=date text. So 'week' label row holds DATE; week# is row above.
# Print week# (wr-1), date(wr), game(gr), tee(tr), winner row for context.
maxcol=max(ci for (_,ci) in cm.keys())
print(f"  scanning cols F..{num_to_col(maxcol)} (rows: wk#={wr-1 if wr else '?'}, date={wr}, game={gr}, tee={tr})")
print(f"\n  {'col':>4} {'wk#':>4} {'date':14} {'tee':7} side_game")
for ci in range(col_to_num("F"), maxcol+1):
    wknum=cm.get((wr-1,ci)) if wr else None
    date=cm.get((wr,ci)) if wr else None
    game=cm.get((gr,ci)) if gr else None
    tee=cm.get((tr,ci)) if tr else None
    if wknum is None and date is None and tee is None and game is None:
        continue
    # only show columns that look like a round (have a week number or date or tee)
    if wknum is None and date is None and tee is None:
        continue
    print(f"  {num_to_col(ci):>4} {str(wknum):>4} {str(date):14.14} {str(tee):7.7} {game}")
