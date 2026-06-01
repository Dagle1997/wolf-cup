#!/usr/bin/env python3
import zipfile, xml.etree.ElementTree as ET
NS={"ss":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
def num_to_col(n):
    s=""
    while n>0:
        n,r=divmod(n-1,26);s=chr(65+r)+s
    return s
def col_to_num(col):
    n=0
    for c in col:n=n*26+(ord(c)-ord("A")+1)
    return n
def parse_ref(ref):
    col="";row=""
    for c in ref:
        if c.isalpha():col+=c
        else:row+=c
    return col,int(row)
path="reference/Wolf Cup 2024 Final.xlsm"
with zipfile.ZipFile(path) as z:
    ssr=ET.parse(z.open("xl/sharedStrings.xml")).getroot()
    shared=["".join(t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")) for si in ssr.findall("ss:si",NS)]
    root=ET.parse(z.open("xl/worksheets/sheet1.xml")).getroot()
cm={}
for row_el in root.findall(".//ss:row",NS):
    ri=int(row_el.get("r"))
    for c in row_el.findall("ss:c",NS):
        ref=c.get("r","");t=c.get("t","");v=c.find("ss:v",NS)
        if v is not None and v.text:
            cs,_=parse_ref(ref);ci=col_to_num(cs)
            cm[(ri,ci)]=shared[int(v.text)] if t=="s" else v.text
maxcol=max(ci for (_,ci) in cm.keys())
print(f"2024 'Auto - Printable'  (wk#=row1, date=row2, game=row3, winner=row4, tee=row5)")
print(f"  {'col':>4} {'wk#':>4} {'date':12} {'tee':7} side_game")
for ci in range(col_to_num("C"), maxcol+1):
    wk=cm.get((1,ci));date=cm.get((2,ci));game=cm.get((3,ci));tee=cm.get((5,ci))
    if wk is None and date is None and game is None and tee is None: continue
    print(f"  {num_to_col(ci):>4} {str(wk):>4} {str(date):12.12} {str(tee):7.7} {game}")
