#!/usr/bin/env python3
import sys, zipfile, xml.etree.ElementTree as ET
NS={"ss":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
def num_to_col(n):
    s=""
    while n>0:
        n,r=divmod(n-1,26); s=chr(65+r)+s
    return s
def col_to_num(col):
    n=0
    for c in col: n=n*26+(ord(c)-ord("A")+1)
    return n
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
    # workbook sheet names
    wb=ET.parse(z.open("xl/workbook.xml")).getroot()
    names=[s.get("name") for s in wb.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet")]
    print("SHEET NAMES:",names)
    sheets=sorted([n for n in z.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")])
    KEYS=("tee","week","side","closest","skins","net par","under par","blue","black","white")
    for name in sheets:
        root=ET.parse(z.open(name)).getroot()
        hits=[]
        for row_el in root.findall(".//ss:row",NS):
            ri=int(row_el.get("r"))
            for c in row_el.findall("ss:c",NS):
                if c.get("t")=="s":
                    v=c.find("ss:v",NS)
                    if v is not None and v.text:
                        val=shared[int(v.text)]
                        low=val.strip().lower()
                        if any(k in low for k in KEYS) and len(val)<30:
                            cs,_=parse_ref(c.get("r",""))
                            hits.append((ri,cs,val.strip()))
        if hits:
            print(f"\n=== {name}  ({len(hits)} label-ish hits) ===")
            for ri,cs,val in hits[:60]:
                print(f"   {cs}{ri}: {val!r}")
