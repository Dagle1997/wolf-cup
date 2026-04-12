#!/usr/bin/env python3
"""
Wolf Cup Test Data Simulator
Creates 5 official rounds for Test 2026 season with realistic scoring data.
"""

import os
import random
import json
import sys
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "https://wolf.dagle.cloud/api"
SEASON_ID = 2

ROUNDS_CONFIG = [
    {"date": "2026-05-02", "tee": "blue"},
    {"date": "2026-05-09", "tee": "white"},
    {"date": "2026-05-16", "tee": "blue"},
    {"date": "2026-05-23", "tee": "black"},
    {"date": "2026-05-30", "tee": "white"},
]

ENTRY_CODE = "1234"

# Roster: id, handicap_index, name
ROSTER = [
    (20, 7.4, "Ben McGinnis"),
    (24, 17.9, "Bob Marshall"),
    (23, 24.1, "Chris Keaton"),
    (15, 14.2, "Chris McNeely"),
    (44, 6.8, "Chris Preston"),
    (12, 4.9, "Jason Moses"),
    (22, 20.1, "Jeff Biederman"),
    (19, 9.3, "Jeff Madden"),
    (10, 8.2, "John Patterson"),
    (14, 16.7, "Josh Stoll"),
    (21, 13.2, "Kyle Cox"),
    (9, 16.5, "Matt Jaquint"),
    (11, 6.5, "Matt White"),
    (16, 13.4, "Michael Bonner"),
    (17, 10.7, "Ronnie Adkins"),
    (13, 19.7, "Scott Pierson"),
    (25, 18.2, "Sean Wilson"),
    (18, 7.1, "Tim Biller"),
]

# Sub players (not in roster) — we'll pick from roster but mark as sub
# Actually, the user said "plus 1 sub per week". We'll designate one of the
# selected players as a sub each week (the last selected).

# Course data: hole_number -> (par, stroke_index)
COURSE = {
    1:  (4, 5),
    2:  (4, 11),
    3:  (4, 9),
    4:  (5, 1),
    5:  (4, 3),
    6:  (3, 17),
    7:  (3, 7),   # PAR3 per code: holes 6, 7, 12, 15
    8:  (4, 15),  # NOT par 3 in code
    9:  (4, 13),
    10: (4, 4),
    11: (4, 10),
    12: (3, 18),
    13: (5, 2),
    14: (4, 16),  # NOT par 3 in code
    15: (3, 6),   # PAR3 per code
    16: (4, 12),
    17: (4, 8),
    18: (5, 14),
}

# Par-3 holes per the actual code (PAR3_HOLES = {6, 7, 12, 15})
PAR3_HOLES = {6, 7, 12, 15}

# Wolf rotation table (hole -> batting position index)
WOLF_TABLE = {
    3: 0, 6: 0, 9: 0, 14: 0,
    4: 1, 7: 1, 10: 1, 16: 1,
    5: 2, 11: 2, 12: 2, 17: 2,
    8: 3, 13: 3, 15: 3, 18: 3,
}


# ---------------------------------------------------------------------------
# Score simulation
# ---------------------------------------------------------------------------

def simulate_gross_score(hi: float, par: int) -> int:
    """Generate a realistic gross score for a hole given handicap index."""
    # Expected strokes over par per hole
    if par == 3:
        base_over = 0.3 + hi * 0.04
    elif par == 5:
        base_over = 0.3 + hi * 0.03
    else:  # par 4
        base_over = 0.5 + hi * 0.04

    expected = par + base_over

    # Random variation
    r = random.random()
    if hi < 8:
        # Low handicapper: more birdies
        if r < 0.03:
            variation = -2  # eagle on par 5, rare
        elif r < 0.18:
            variation = -1  # birdie
        elif r < 0.55:
            variation = 0   # par
        elif r < 0.85:
            variation = 1   # bogey
        elif r < 0.95:
            variation = 2   # double
        else:
            variation = 3   # triple (rare)
    elif hi > 18:
        # High handicapper: more doubles/triples
        if r < 0.03:
            variation = -1  # birdie (rare)
        elif r < 0.20:
            variation = 0   # par
        elif r < 0.50:
            variation = 1   # bogey
        elif r < 0.75:
            variation = 2   # double
        elif r < 0.90:
            variation = 3   # triple
        else:
            variation = 4   # blow-up
    else:
        # Mid handicapper
        if r < 0.08:
            variation = -1  # birdie
        elif r < 0.35:
            variation = 0   # par
        elif r < 0.65:
            variation = 1   # bogey
        elif r < 0.85:
            variation = 2   # double
        elif r < 0.95:
            variation = 3   # triple
        else:
            variation = 4

    score = int(round(expected + variation))
    return max(score, par - 1)  # nobody scores more than 1 under par


def simulate_group_scores(group_players):
    """
    Simulate 18 holes of scores for a group of 4 players.
    Returns: {player_id: {hole_number: gross_score}}
    """
    scores = {}
    for pid, hi, name in group_players:
        scores[pid] = {}
        for hole in range(1, 19):
            par, si = COURSE[hole]
            scores[pid][hole] = simulate_gross_score(hi, par)
    return scores


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

session = requests.Session()
session.verify = True


def login():
    """Log in as admin and capture session cookie."""
    print("Logging in as admin...")
    r = session.post(f"{BASE_URL}/admin/login", json={
        "username": "josh",
        "password": os.environ.get("ADMIN_JOSH_PASSWORD", "changeme-josh")
    })
    if r.status_code != 200:
        print(f"  FAILED: {r.status_code} {r.text}")
        sys.exit(1)
    print(f"  OK — session established")
    return r.json()


def create_round(scheduled_date: str, tee: str) -> dict:
    """Create an official round."""
    r = session.post(f"{BASE_URL}/admin/rounds", json={
        "seasonId": SEASON_ID,
        "type": "official",
        "scheduledDate": scheduled_date,
        "entryCode": ENTRY_CODE,
        "tee": tee,
    })
    if r.status_code not in (200, 201):
        print(f"  Create round FAILED: {r.status_code} {r.text}")
        sys.exit(1)
    data = r.json()
    round_data = data.get("round", data)
    print(f"  Created round id={round_data['id']} date={scheduled_date} tee={tee}")
    return round_data


def activate_round(round_id: int):
    """Set round status to active."""
    r = session.patch(f"{BASE_URL}/admin/rounds/{round_id}", json={
        "status": "active"
    })
    if r.status_code != 200:
        print(f"  Activate round FAILED: {r.status_code} {r.text}")
        sys.exit(1)
    print(f"  Activated round {round_id}")


def create_group(round_id: int, group_number: int) -> int:
    """Create a group and return its ID."""
    r = session.post(f"{BASE_URL}/admin/rounds/{round_id}/groups", json={
        "groupNumber": group_number
    })
    if r.status_code not in (200, 201):
        print(f"  Create group FAILED: {r.status_code} {r.text}")
        sys.exit(1)
    data = r.json()
    group_data = data.get("group", data)
    return group_data["id"]


def add_player_to_group(round_id: int, group_id: int, player_id: int, hi: float, is_sub: bool = False):
    """Add a player to a group."""
    r = session.post(f"{BASE_URL}/admin/rounds/{round_id}/groups/{group_id}/players", json={
        "playerId": player_id,
        "handicapIndex": hi,
        "isSub": is_sub,
    })
    if r.status_code not in (200, 201):
        print(f"  Add player {player_id} FAILED: {r.status_code} {r.text}")
        return False
    return True


def set_batting_order(round_id: int, group_id: int, order: list, tee: str):
    """Set the batting order for a group."""
    r = session.put(
        f"{BASE_URL}/rounds/{round_id}/groups/{group_id}/batting-order",
        json={"order": order, "tee": tee},
        headers={"x-entry-code": ENTRY_CODE}
    )
    if r.status_code != 200:
        print(f"  Set batting order FAILED: {r.status_code} {r.text}")
        return False
    return True


def submit_hole_scores(round_id: int, group_id: int, hole_number: int, scores: list):
    """Submit scores for a hole. scores = [{playerId, grossScore}, ...]"""
    r = session.post(
        f"{BASE_URL}/rounds/{round_id}/groups/{group_id}/holes/{hole_number}/scores",
        json={"scores": scores},
        headers={"x-entry-code": ENTRY_CODE}
    )
    if r.status_code != 200:
        print(f"  Submit scores hole {hole_number} FAILED: {r.status_code} {r.text}")
        return False
    return True


def submit_wolf_decision(round_id: int, group_id: int, hole_number: int, body: dict):
    """Submit wolf decision for a hole."""
    r = session.post(
        f"{BASE_URL}/rounds/{round_id}/groups/{group_id}/holes/{hole_number}/wolf-decision",
        json=body,
        headers={"x-entry-code": ENTRY_CODE}
    )
    if r.status_code != 200:
        print(f"  Wolf decision hole {hole_number} FAILED: {r.status_code} {r.text}")
        return False
    return True


def finalize_round(round_id: int):
    """Finalize the round."""
    r = session.post(f"{BASE_URL}/admin/rounds/{round_id}/finalize")
    if r.status_code != 200:
        print(f"  Finalize FAILED: {r.status_code} {r.text}")
        return False
    print(f"  Finalized round {round_id}")
    return True


# ---------------------------------------------------------------------------
# Wolf decision simulation
# ---------------------------------------------------------------------------

def simulate_wolf_decision(hole_number: int, batting_order: list, group_players_map: dict, hole_scores: dict):
    """
    Simulate a wolf decision for a hole.
    Returns a dict suitable for the wolf-decision API.
    """
    is_skin_hole = hole_number <= 2

    body = {}

    if is_skin_hole:
        # No wolf decision on skins holes; just bonuses
        pass
    else:
        wolf_batter_idx = WOLF_TABLE[hole_number]
        wolf_pid = batting_order[wolf_batter_idx]
        non_wolf_pids = [pid for pid in batting_order if pid != wolf_pid]

        # Decide: partner (70%), alone (20%), blind_wolf (10%)
        r = random.random()
        if r < 0.10:
            body["decision"] = "blind_wolf"
        elif r < 0.30:
            body["decision"] = "alone"
        else:
            body["decision"] = "partner"
            # Pick a partner — prefer lower handicap players
            partner = random.choice(non_wolf_pids)
            body["partnerPlayerId"] = partner

    # Greenies on par-3 holes
    if hole_number in PAR3_HOLES:
        # ~30% chance someone gets a greenie
        greenie_candidates = []
        for pid in batting_order:
            hi = group_players_map[pid][1]  # handicap index
            score = hole_scores.get(pid, {}).get(hole_number, 5)
            par = COURSE[hole_number][0]
            # Greenie: on green from tee + par or better + 2-putt or better
            # Approximate: lower score => higher chance of greenie
            if score <= par:
                if random.random() < 0.6:
                    greenie_candidates.append(pid)
            elif score == par + 1:
                if random.random() < 0.2:
                    greenie_candidates.append(pid)
        if greenie_candidates:
            # Usually just 1 greenie
            body["greenies"] = [random.choice(greenie_candidates)]
        else:
            body["greenies"] = []
    else:
        body["greenies"] = []

    # Polies: ~5% chance per player per hole
    polies = []
    for pid in batting_order:
        if random.random() < 0.05:
            polies.append(pid)
    body["polies"] = polies

    return body


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------

def select_players_for_round(round_index: int):
    """
    Select 12-16 players (multiple of 4) for a round, plus mark 1 as sub.
    Vary selection each week.
    """
    random.seed(42 + round_index * 7)  # Reproducible but different each week

    # Shuffle roster and pick 12, 16, 16, 12, 16 for variety
    counts = [12, 16, 16, 12, 16]
    count = counts[round_index % len(counts)]

    shuffled = list(ROSTER)
    random.shuffle(shuffled)
    selected = shuffled[:count]

    # Last player is the "sub"
    sub_id = selected[-1][0]

    return selected, sub_id


def run():
    random.seed(2026)

    login()

    round_summaries = []

    for ri, rc in enumerate(ROUNDS_CONFIG):
        print(f"\n{'='*60}")
        print(f"ROUND {ri+1}/5 — {rc['date']} ({rc['tee']} tees)")
        print(f"{'='*60}")

        # Select players
        selected_players, sub_id = select_players_for_round(ri)
        num_groups = len(selected_players) // 4
        print(f"  Players: {len(selected_players)} ({num_groups} groups), sub: id={sub_id}")

        # Create round
        round_data = create_round(rc["date"], rc["tee"])
        round_id = round_data["id"]

        # Activate round
        activate_round(round_id)

        # Create groups and add players
        group_ids = []
        group_player_lists = []  # list of lists of (pid, hi, name)
        for gi in range(num_groups):
            gid = create_group(round_id, gi + 1)
            group_ids.append(gid)

            start = gi * 4
            group_4 = selected_players[start:start + 4]
            group_player_lists.append(group_4)

            for pid, hi, name in group_4:
                is_sub = (pid == sub_id)
                ok = add_player_to_group(round_id, gid, pid, hi, is_sub)
                if not ok:
                    print(f"    WARNING: Could not add player {name} (id={pid})")

            print(f"  Group {gi+1} (id={gid}): {', '.join(n for _,_,n in group_4)}")

        # Set batting orders and simulate scoring
        for gi, (gid, group_4) in enumerate(zip(group_ids, group_player_lists)):
            batting_order = [pid for pid, _, _ in group_4]
            random.shuffle(batting_order)

            ok = set_batting_order(round_id, gid, batting_order, rc["tee"])
            if not ok:
                print(f"  SKIPPING group {gi+1} — batting order failed")
                continue

            # Build player map: pid -> (pid, hi, name)
            group_players_map = {pid: (pid, hi, name) for pid, hi, name in group_4}

            # Simulate scores
            scores = simulate_group_scores(group_4)

            # Submit scores and wolf decisions hole by hole
            for hole in range(1, 19):
                hole_scores_list = [
                    {"playerId": pid, "grossScore": scores[pid][hole]}
                    for pid in batting_order
                ]
                ok = submit_hole_scores(round_id, gid, hole, hole_scores_list)
                if not ok:
                    continue

                # Wolf decision
                wolf_body = simulate_wolf_decision(hole, batting_order, group_players_map, scores)
                ok = submit_wolf_decision(round_id, gid, hole, wolf_body)
                if not ok:
                    continue

            # Print group totals
            for pid, hi, name in group_4:
                total = sum(scores[pid][h] for h in range(1, 19))
                print(f"    {name:20s} (HI {hi:5.1f}): {total}")

            print(f"  Group {gi+1} scoring complete (18 holes)")

        # Finalize
        finalize_round(round_id)

        round_summaries.append({
            "round_id": round_id,
            "date": rc["date"],
            "tee": rc["tee"],
            "players": len(selected_players),
            "groups": num_groups,
        })

    # Summary
    print(f"\n{'='*60}")
    print("SIMULATION COMPLETE")
    print(f"{'='*60}")
    for rs in round_summaries:
        print(f"  Round {rs['round_id']:3d} | {rs['date']} | {rs['tee']:6s} | {rs['players']} players | {rs['groups']} groups")

    # Fetch standings
    print("\nFetching season standings...")
    r = session.get(f"{BASE_URL}/standings?seasonId={SEASON_ID}")
    if r.status_code == 200:
        data = r.json()
        items = data.get("items", data.get("standings", []))
        if items:
            print(f"\n{'Rank':>4s}  {'Player':<22s}  {'Points':>8s}")
            print("-" * 40)
            for item in items[:20]:
                name = item.get("playerName", item.get("name", "?"))
                pts = item.get("totalPoints", item.get("points", "?"))
                rank = item.get("rank", "?")
                print(f"{rank:>4}  {name:<22s}  {pts:>8}")
    else:
        print(f"  Could not fetch standings: {r.status_code}")


if __name__ == "__main__":
    run()
