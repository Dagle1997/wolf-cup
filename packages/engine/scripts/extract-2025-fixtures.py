#!/usr/bin/env python3
"""
One-time extraction script: reads Wolf Cup 2025 Final Sheet Season Ended.xlsm
and writes 15 round fixture JSON files + season-standings.json.

Run from repo root:
  python3 packages/engine/scripts/extract-2025-fixtures.py
"""

import json
import os
import zipfile
import xml.etree.ElementTree as ET

XLSM_PATH = "reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm"
OUT_DIR = "packages/engine/src/fixtures/season-2025"

NS = {"ss": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# ---------------------------------------------------------------------------
# Column helpers
# ---------------------------------------------------------------------------

def col_to_num(col: str) -> int:
    n = 0
    for c in col:
        n = n * 26 + (ord(c) - ord("A") + 1)
    return n

def parse_cell_ref(ref: str):
    col = ""
    row = ""
    for c in ref:
        if c.isalpha():
            col += c
        else:
            row += c
    return col, int(row)

# ---------------------------------------------------------------------------
# Round definitions
# Columns are 1-indexed. Each round has an input_col (ODD) and calc_col (EVEN).
#   - input_col / harvey_row  = stableford golf score (entered by user)
#   - input_col / cash_row    = money balance (entered by user)
#   - calc_col  / stableford_row = combined Harvey (stableford Harvey + money Harvey)
#   - calc_col  / harvey_row  = stableford Harvey component
#   - calc_col  / cash_row    = money Harvey component
# ---------------------------------------------------------------------------

ROUNDS = [
    #  (round_num, input_col, calc_col, iso_date)
    (1,  col_to_num("CS"), col_to_num("CT"), "2025-05-02"),
    (2,  col_to_num("CU"), col_to_num("CV"), "2025-05-09"),
    (3,  col_to_num("CW"), col_to_num("CX"), "2025-05-16"),
    (4,  col_to_num("CY"), col_to_num("CZ"), "2025-05-23"),
    # Rainout slot 1: DA/DB (May 30 rainout — some players may have makeup data here)
    (0,  col_to_num("DA"), col_to_num("DB"), "2025-05-30"),
    (5,  col_to_num("DC"), col_to_num("DD"), "2025-06-13"),
    (6,  col_to_num("DE"), col_to_num("DF"), "2025-06-20"),
    (7,  col_to_num("DG"), col_to_num("DH"), "2025-06-27"),
    (8,  col_to_num("DI"), col_to_num("DJ"), "2025-07-04"),
    (9,  col_to_num("DK"), col_to_num("DL"), "2025-07-11"),
    (10, col_to_num("DM"), col_to_num("DN"), "2025-07-18"),
    (11, col_to_num("DO"), col_to_num("DP"), "2025-07-25"),
    (12, col_to_num("DQ"), col_to_num("DR"), "2025-08-01"),
    (13, col_to_num("DS"), col_to_num("DT"), "2025-08-08"),
    (14, col_to_num("DU"), col_to_num("DV"), "2025-08-15"),
    (15, col_to_num("DW"), col_to_num("DX"), "2025-08-22"),
    # Rainout slots 2-3: DY/DZ and EA/EB (may contain makeup round data)
    (16, col_to_num("DY"), col_to_num("DZ"), "2025-makeup-1"),
    (17, col_to_num("EA"), col_to_num("EB"), "2025-makeup-2"),
]

# Rows with these E-column values are NOT player stableford rows
SKIP_E_VALUES = {
    "Harvey Points", "cash +/-", "AVERAGE", "TEES", "WEEK", "Side Game",
    "Winner", "*MUST EQUAL 0", "Money Test", "Points", "Players",
    "Points Test", "Subs", "Week", "Tees",
}

# Regular league members are in rows 6–62 (B column = integer rank 1–18).
# Subs are rows 75–116.
# We include ALL player rows (regular + subs) in round fixtures.
# Season standings only includes players with roundsPlayed > 0 and rows <= 62.
REGULAR_PLAYER_MAX_ROW = 62

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

def load_sheet(xlsm_path: str):
    with zipfile.ZipFile(xlsm_path) as z:
        # Shared strings
        with z.open("xl/sharedStrings.xml") as f:
            ss_root = ET.parse(f).getroot()
        shared = []
        for si in ss_root.findall("ss:si", NS):
            parts = []
            for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"):
                if t.text:
                    parts.append(t.text)
            shared.append("".join(parts))

        # Sheet2 (Standings)
        with z.open("xl/worksheets/sheet2.xml") as f:
            sheet_root = ET.parse(f).getroot()

    # Build cell map: (row_idx, col_idx) -> numeric or string value
    cell_map: dict[tuple[int, int], object] = {}
    for row_el in sheet_root.findall(".//ss:row", NS):
        row_idx = int(row_el.get("r"))
        for c in row_el.findall("ss:c", NS):
            ref = c.get("r", "")
            t = c.get("t", "")
            v_el = c.find("ss:v", NS)
            if v_el is not None and v_el.text:
                col_str, _ = parse_cell_ref(ref)
                col_idx = col_to_num(col_str)
                if t == "s":
                    val = shared[int(v_el.text)]
                else:
                    try:
                        val = float(v_el.text)
                    except ValueError:
                        val = v_el.text
                cell_map[(row_idx, col_idx)] = val

    return cell_map, shared

# ---------------------------------------------------------------------------
# Find player rows
# ---------------------------------------------------------------------------

def find_player_rows(cell_map: dict) -> list[dict]:
    """
    Returns list of {name, stableford_row, harvey_row, cash_row}.
    A stableford row has a non-empty, non-SKIP column-E value.
    """
    COL_E = col_to_num("E")

    players = []
    # Scan rows 6–116 (all player rows including subs)
    for r in range(6, 120):
        e_val = cell_map.get((r, COL_E), "")
        if isinstance(e_val, float):
            # Numeric E value — skip
            continue
        e_str = str(e_val).strip()
        if not e_str or e_str in SKIP_E_VALUES:
            continue

        players.append({
            "name": e_str,
            "stableford_row": r,
            "harvey_row": r + 1,
            "cash_row": r + 2,
        })

    return players

# ---------------------------------------------------------------------------
# Extract round fixtures
# ---------------------------------------------------------------------------

def extract_rounds(cell_map: dict, players: list[dict]) -> list[dict]:
    rounds_out = []

    for round_num, input_col, calc_col, iso_date in ROUNDS:
        player_fixtures = []

        for p in players:
            hr = p["harvey_row"]
            cr = p["cash_row"]
            sr = p["stableford_row"]

            # Stableford score in input_col / harvey row
            stableford_raw = cell_map.get((hr, input_col))
            if stableford_raw is None or stableford_raw == "" or stableford_raw == 0:
                continue  # Player did not participate in this round

            stableford = float(stableford_raw)
            money_raw = cell_map.get((cr, input_col), 0)
            money = float(money_raw) if money_raw not in (None, "") else 0.0

            # Expected Harvey from calc columns
            exp_stab_raw = cell_map.get((hr, calc_col))
            exp_money_raw = cell_map.get((cr, calc_col))

            if exp_stab_raw is None or exp_money_raw is None:
                # If calc cols are missing, skip (data integrity issue)
                print(f"  WARN: Missing calc data for {p['name']} round {round_num}")
                continue

            exp_stab = float(exp_stab_raw)
            exp_money = float(exp_money_raw)

            player_fixtures.append({
                "name": p["name"],
                "stableford": stableford,
                "money": money,
                "expectedHarveyStableford": exp_stab,
                "expectedHarveyMoney": exp_money,
            })

        if not player_fixtures:
            print(f"  WARN: No players found for round {round_num} ({iso_date})")
            continue

        rounds_out.append({
            "round": round_num,
            "date": iso_date,
            "players": player_fixtures,
        })

    return rounds_out

# ---------------------------------------------------------------------------
# Extract season standings (regular players only)
# ---------------------------------------------------------------------------

def extract_season_standings(cell_map: dict, players: list[dict]) -> dict:
    COL_C = col_to_num("C")  # Season total Harvey (combined, best-10)
    COL_F = col_to_num("F")  # Rounds played

    standings = []
    for p in players:
        if p["stableford_row"] > REGULAR_PLAYER_MAX_ROW:
            continue  # Skip subs for season standings

        sr = p["stableford_row"]
        rounds_played_raw = cell_map.get((sr, COL_F), 0)
        rounds_played = int(float(rounds_played_raw)) if rounds_played_raw not in (None, "") else 0

        if rounds_played == 0:
            continue  # Skip players who never played

        season_total_raw = cell_map.get((sr, COL_C), 0)
        season_total = float(season_total_raw) if season_total_raw not in (None, "") else 0.0

        rounds_dropped = max(0, rounds_played - 10)

        standings.append({
            "name": p["name"],
            "roundsPlayed": rounds_played,
            "roundsDropped": rounds_dropped,
            "expectedSeasonTotal": season_total,
        })

    return {"players": standings}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Loading {XLSM_PATH}...")
    cell_map, shared = load_sheet(XLSM_PATH)
    print(f"  Loaded {len(cell_map)} cells")

    print("Finding player rows...")
    players = find_player_rows(cell_map)
    print(f"  Found {len(players)} players: {[p['name'] for p in players]}")

    print("Extracting round fixtures...")
    rounds = extract_rounds(cell_map, players)

    os.makedirs(OUT_DIR, exist_ok=True)
    for r in rounds:
        filename = f"round-{r['round']:02d}.json"
        out_path = os.path.join(OUT_DIR, filename)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(r, f, indent=2)
        print(f"  Wrote {out_path} ({len(r['players'])} players)")

    print("Extracting season standings...")
    standings = extract_season_standings(cell_map, players)
    standings_path = os.path.join(OUT_DIR, "season-standings.json")
    with open(standings_path, "w", encoding="utf-8") as f:
        json.dump(standings, f, indent=2)
    print(f"  Wrote {standings_path} ({len(standings['players'])} players)")

    print("Done.")

if __name__ == "__main__":
    main()
