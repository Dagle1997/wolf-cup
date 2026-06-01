#!/usr/bin/env python3
import zipfile, xml.etree.ElementTree as ET

XLSM = "reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm"
NS = {"ss": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def col_to_num(col):
    n = 0
    for c in col: n = n*26 + (ord(c)-ord("A")+1)
    return n
def num_to_col(n):
    s=""
    while n>0:
        n,r=divmod(n-1,26); s=chr(65+r)+s
    return s
def parse_ref(ref):
    col="";row=""
    for c in ref:
        (col:=col+c) if c.isalpha() else (row:=row+c)
    return col,int(row)

with zipfile.ZipFile(XLSM) as z:
    ssr = ET.parse(z.open("xl/sharedStrings.xml")).getroot()
    shared=[]
    for si in ssr.findall("ss:si",NS):
        shared.append("".join(t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
    sheet = ET.parse(z.open("xl/worksheets/sheet2.xml")).getroot()

cell={}
for row_el in sheet.findall(".//ss:row",NS):
    ri=int(row_el.get("r"))
    for c in row_el.findall("ss:c",NS):
        ref=c.get("r","");t=c.get("t","");v=c.find("ss:v",NS)
        if v is not None and v.text:
            cs,_=parse_ref(ref); ci=col_to_num(cs)
            val = shared[int(v.text)] if t=="s" else v.text
            cell[(ri,ci)]=val

COL_E=col_to_num("E")
# find label rows in col E
print("=== Column E labels (rows 1-12) to locate TEES / WEEK / Side Game rows ===")
for r in range(1,13):
    print(f"  row {r}: E={cell.get((r,COL_E))!r}")

# round columns from the extract script (input_col)
ROUNDS = [
    (1,"CS","2025-05-02"),(2,"CU","2025-05-09"),(3,"CW","2025-05-16"),(4,"CY","2025-05-23"),
    (0,"DA","2025-05-30 RAINOUT"),(5,"DC","2025-06-13"),(6,"DE","2025-06-20"),(7,"DG","2025-06-27"),
    (8,"DI","2025-07-04"),(9,"DK","2025-07-11"),(10,"DM","2025-07-18"),(11,"DO","2025-07-25"),
    (12,"DQ","2025-08-01"),(13,"DS","2025-08-08"),(14,"DU","2025-08-15"),(15,"DW","2025-08-22"),
    (16,"DY","makeup-1"),(17,"EA","makeup-2"),
]

print("\n=== Per round column: rows 1-6 (raw) at input_col + calc_col ===")
for rn,cstr,date in ROUNDS:
    ci=col_to_num(cstr); ci2=ci+1
    vals_in=[cell.get((r,ci)) for r in range(1,7)]
    vals_ca=[cell.get((r,ci2)) for r in range(1,7)]
    print(f"\n  R{rn:>2} {date:18s} col {cstr}({num_to_col(ci2)})")
    for r in range(1,7):
        print(f"      row{r}: {cstr}={cell.get((r,ci))!r:30s} {num_to_col(ci2)}={cell.get((r,ci2))!r}")
