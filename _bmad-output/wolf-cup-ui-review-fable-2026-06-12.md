# Wolf Cup Web — Fable 5 UI/UX Review (2026-06-12)

_Read-only design review. Nothing built/deployed. For discussion._

All spot-checks against the cited source confirm the team's claims (amber light-only banners at index.tsx:1117/1167/1217, the `Stab/$` cell at standings.tsx:354/662, the triplicated `formatMoney`, the bonuses-above-wolf ordering at score-entry-hole.tsx:1114/1195). Consolidated review follows.

---

# WOLF CUP WEB — CONSOLIDATED DESIGN REVIEW

## 1. Verdict

You're right: the UI is good — and not in a flattering-the-owner way. The hard problems are solved with visible care: the leaderboard accordion deliberately survives the 5s poll (index.tsx:722-731), score entry has a real offline queue with visible pending state, the Standings cut line / sub bucketing / pin-me affordances are coherent, and the HoleBadge golf notation is best-in-class. **No redesign is warranted anywhere.**

The remaining friction is all at the *seams*: one relationship stat scattered across four widgets, the same dollar rendered three ways, a handful of banners that forgot dark mode on exactly the two screens used on the course, and a few sub-44px targets the rest of the app already outgrew in T12. Everything below is surgical.

---

## 2. Top proposals (prioritized)

### P1 — Callout primitive: one status banner, dark mode fixed everywhere — **Effort: S**

**Problem:** ~10 hand-rolled status banners share one anatomy but only some have `dark:` variants. Light-only offenders flash as bright cream/white slabs in dark mode: divergence banner (index.tsx:1117), both side-game winner banners (index.tsx:1167, 1217), Round Finalized/Practice banners (score-entry-hole.tsx:769, 774), side-game info banner (score-entry-hole.tsx:1019), plus ScoutingPanel's tier/grade chips (ScoutingPanel.tsx:95-102, 248-250). The correct pattern already exists 50 lines away — the pending-sync banner at score-entry-hole.tsx:973 does it right.

**Change:** Add `components/ui/callout.tsx` — `<Callout tone="info|success|warning|gold">` owning the light+dark pair once; find/replace the ~10 banners; align ScoutingPanel chips to the same tokens.

```
tone -> (bg / border / text) defined ONCE:
  info    : blue-50 /blue-200  | dark: blue-950/30 /blue-800 /blue-300
  success : green-50/green-300 | dark: green-950/30/green-800/green-300
  warning : amber-50/amber-300 | dark: amber-950/30/amber-700/amber-300
  gold    : tappable amber banner-link style

DARK MODE, Board today:        proposed:
▓ BRIGHT CREAM SLAB ▓     →    ┌──────────────────────────────────┐
                               │ ▒ Most Polies Winner: Chris (4) ▒│
                               │   amber-950/30 bg, amber-300 text│
                               └──────────────────────────────────┘
```

**Why:** Dawn tee times make dark mode a primary theme, and the broken banners sit on the Board and Score Entry — the two on-course screens. Highest fix-per-line in the whole review, and it prevents regression permanently.

---

### P2 — Score entry: par-anchored score chips instead of the OS keyboard — **Effort: M**

**Problem:** Free-text single-digit inputs (score-entry-hole.tsx:1069-1091) summon the OS keyboard (~45% of viewport, tiny keys), require a fragile iOS focus-persistence hack in the Save handler (:1396-1401), and `maxLength={1}` makes a 10 untypeable even though validation accepts 20 (:914).

**Change:** Six tap chips per player centered on par (par−2…par+3), par chip outlined, `+` chip expands 8-12. Selecting auto-advances the active player, same flow as today's focus advance — no keyboard, no hack.

```
  Hole 4        Par 4 · SI 5         3/18  🐺 Matt

  ┌─ 1. Josh ─────────────────────────────────┐
  │  ( 2 ) ( 3 ) ( 4 ) (▣5▣) ( 6 ) ( 7 ) (+)  │  ← 5 selected
  └───────────────────────────────────────────┘
  ┌─ 2. Tim  ◀ next ──────────────────────────┐
  │  ( 2 ) ( 3 ) (·4·) ( 5 ) ( 6 ) ( 7 ) (+)  │  ← par outlined
  └───────────────────────────────────────────┘
  tap (+) →  ( 8 ) ( 9 ) ( 10 ) ( 11 ) ( 12 )

  ┌───────────────────────────────────────────┐
  │              Save Hole 4                  │  ← never hidden by keyboard
  └───────────────────────────────────────────┘
```

**Why:** Gloved-thumb, sun-glare entry with the group watching. 44px+ targets, the whole hole stays on screen, a filled chip two slots right of par reads as "double" at arm's length. On putts weeks, the same chip component does 0-4+ putts and folds into the advance order (today's putt inputs are skipped by auto-advance but block Save — :1083-1089 vs :915-920). This is the one proposal with medium risk; prototype it on one hole first.

---

### P3 — Wolf card: move above the score grid + one way to go alone — **Effort: S**

**Problem:** Two issues, one card. (a) Screen order is scores → bonuses → wolf (:1065, :1114, :1191), but the wolf call happens *at the tee* before anyone has a score — the most time-sensitive control is at the bottom of the scroll. (b) There are two redundant paths to "alone" (tap the wolf's own row :1213-1222, or a separate "Wolf" button :1260-1277), and "Wolf" simultaneously names the player, the section, and the action.

**Change:** On wolf holes, render the wolf card directly under the header; once decided, collapse to a one-line strip. Remove the wolf from the partner list; exactly two action buttons, labeled with stakes.

```
  AT THE TEE:
  ┌────────────────────────────────────────────┐
  │ 🐺 MATT'S WOLF HOLE — pick before tee shots│
  │  Partner — tap a name:                     │
  │  [   Josh   ] [   Tim   ] [   Jeff   ]     │
  │  ┌──────────────────┐ ┌─────────────────┐  │
  │  │   Alone  ×2      │ │  Blind Wolf ×3  │  │
  │  └──────────────────┘ └─────────────────┘  │
  └────────────────────────────────────────────┘
  ┌─ 1. Josh ──────┐ ┌─ 2. Tim ───────┐
  │  score chips…  │ │  score chips…  │

  AFTER DECISION (collapsed):
  ┌────────────────────────────────────────────┐
  │ 🐺 Matt + Josh ✓              tap to change│
  └────────────────────────────────────────────┘
```

**Why:** Wolf calls are money decisions made once, with four guys waiting. Match play order, give each outcome exactly one affordance, and the ×2/×3 labels teach stakes to subs for free. Pure IA reorder, zero new behavior. (Bundle the 32px→44px bonus-chip resize, one player per row, into the same pass — it's the same card stack and the same T12 tap-target standard.)

---

### P4 — Board: tap-to-sort column headers, retire the duplicate chip row — **Effort: M**

**Problem:** Column headers already grow a sort caret (index.tsx:822-832) but aren't tappable, while a separate chip row (:784-800) duplicates the same axes with mismatched labels (chip "Stableford" vs header "Stb"). And there's a real bug: a `'par'` pref persisted from a Harvey-off week carries into a Harvey week whose chip options don't include it (:707, :742-749) — **no chip renders selected** while the To Par header still carets.

**Change:** Make the four numeric headers tappable sort buttons (44px hit areas, active = bold + caret); delete the chip row. The control row becomes just All/Group + Scouting and never wraps at 375px. The stranded-pref bug disappears structurally because To Par is always a visible header.

```
┌────────────────────────────────────────────────┐
│ ( All │ Group 3 )              ( 🔎 Scouting ) │ ← one row, never wraps
├────────────────────────────────────────────────┤
│  #  Player          To Par   Stb    $   HVY ▾  │ ← headers ARE the sort
│                     ·tap·   ·tap· ·tap·  bold  │   control (44px tall)
│ ────────────────────────────────────────────── │
│ (1) Matt Jaquint      -3     21   +$14    12   │
│     HCP 8.2 · Thru 12                          │
└────────────────────────────────────────────────┘
```

**Why:** Sort where you're looking, reclaim ~32px for board rows, fix a labels-don't-match wart and a genuine no-selected-state bug in one move. Persistence machinery (:529-541) carries over unchanged.

---

### P5 — Board: mark "my group" in the All view — **Effort: S**

**Problem:** The #1 live glance is "where's my foursome?" The session knows the viewer's groupId (index.tsx:711-714) and every row carries groupNumber, but All view shows nothing — you scan 16-20 rows for remembered names or flip to Group view and lose the field.

**Change:** Small group pill in each row's subline; the viewer's group filled green.

```
│ (1) Matt Jaquint        -3    21   +$14 │
│     [G1] HCP 8.2 · Thru 12              │ ← outline pill: other groups
│  4  Josh Stoll          -1    19    +$6 │
│     [G3] HCP 10.1 · Thru 11             │ ← filled green = YOUR group
│  5  Tim Biller          E     18    +$2 │
│     [G3] HCP 6.4 · Thru 11              │ ← also green: same foursome
```

**Why:** Your foursome pops in peripheral vision without leaving the full-field view; group numbers become visible to everyone. One span per row, data already client-side.

---

### P6 — Standings: show the cut math — **Effort: S**

**Problem:** `gapToCut` is computed per player (standings.tsx:417) and then thrown away — reduced to a boolean "⚠ Bubble" chip with no magnitude or side. `rank8Total` is computed (:407-409) and never displayed. The number every bubble player checks on Friday night isn't on the screen.

**Change:** Signed chip in the bubble zone ("+3 IN" / "−4 OUT"), cut value on the divider. Existing gap-to-next label stays.

```
│ (7✓) Chris McNeely      ⚠ +3 IN     📍    298  │
│ (8✓) Tim Biller         ⚠ IN BY 0   📍    295  │
╞═ ─ ─ PLAYOFF CUT — TOP 8 · in at 295 ─ ─ ─ ─ ═╡
│ (9)  Jeff Biederman     ⚠ −4 OUT    📍    291  │
│ (10) Ben Foster         ⚠ −9 OUT    📍    286  │
```

**Why:** Pure surfacing of already-computed data, fits the existing chip slot, makes the divider self-documenting. (The team's "Playoff Picture" bracket card is a good *later* idea, but it needs you to confirm playoff mechanics first — parking it.)

---

### P7 — One `formatMoney` + fix the Standings "Stab/$" cell — **Effort: S**

**Problem:** The app's money convention (signed, $-prefixed, green/red) is implemented identically three times (index.tsx:117, stats.tsx:175, score-entry-hole.tsx:135 — verified) plus two divergent variants — and Standings breaks it: `Stab/$` renders `118/-26` in plain uncolored text (standings.tsx:354, 662) on the one screen that decides the season.

**Change:** Move `formatMoney` to `lib/format.ts`, import everywhere, align ScoutingPanel's Unicode-minus variant; split `Stab/$` into two cells.

```
BEFORE                                   AFTER
+------+------+------+----------+   +------+----------+------+--------+
| AVG  | LOW  | HIGH | STAB/$   |   | AVG  | LOW·HIGH | STB  | MONEY  |
| 11.8 |  6   |  16  | 118/-26  |   | 11.8 |  6 · 16  | 118  |  -$26  | ← red
+------+------+------+----------+   +------+----------+------+--------+
```

**Why:** Money is half the Harvey total; green/red signed dollars are the learned scan pattern from every other screen. Fold the terminology pass in here while touching labels: canonicalize **Stb** ("Pts"→"Stb" on the score-entry summary, "Stab"→"Stb") and **Hvy** ("Hvy Pts"→"Hvy" to match the cheatsheet; Standings' bare "Total" micro-label → "Harvey Pts"). Pure string edits.

---

### P8 — Quick-wins bundle (each individually trivial; ship as one batch) — **Effort: S total**

- **Ball draw:** per-player "your wolf holes" summary card above the 18-row table (derived from existing `wolfSchedule` state) — the single most-glanced pre-round moment.
- **Highlight reel:** reset auto-advance on manual nav; replace 6px dots + text buttons with 40×40 ‹ › targets (index.tsx:594-600, :642, :660-674).
- **Help:** anchor each section + a jump-to chip row at top (same scrollIntoView pattern as standings_.history.tsx:134-144).
- **Stats:** visible "SUBSTITUTES (n)" divider + blue SUB chip — the documented subs rule is enforced (stats.tsx:403-410) but invisible, so Money/Wolf sorts look broken to anyone who doesn't know it.
- **Standings pin button:** 44px hit area, icon unchanged (currently ~22px inside a tappable card).
- **Pairing audit:** auto-select newest round.
- **Gallery lightbox:** prev/next + swipe.
- **Error states:** restore a Retry button on Pairings/Attendance/inline-scorecard (currently none) and replace Odds' full `window.location.reload()` — fold into a tiny shared `<ErrorState onRetry>`.

---

## 3. The relationship-stats coherence problem (your #1 concern)

**The situation:** One relationship — you + another player — appears in FOUR places that never reference each other: the "Best 2v2 Partnership" season slide (2v2 holes only, 5-hole min), the Lucky Charm/Nemesis/Dominate strip (stats.tsx:787-833), the Chemistry card (ALL same-team holes, stats.tsx:1112-1143), and the When Grouped With rivals table (:1145-1182). Same pair, three different numbers, no signpost. Worse, the strip silently mixes units: Lucky Charm is per-ROUND dollars (stats.tsx:115) sitting next to per-HOLE Nemesis/Dominate dollars, all formatted identically.

**Recommended resolution — do NOT change any math.** Narrowing Chemistry back to 2v2 (your option 2) would undo the deliberate 2026-04-26 decision that makes Chemistry reconcile with the rivals row — wrong trade. Instead, reorganize from per-METRIC widgets to per-PAIR rows, plus one small API addition so the numbers visibly reconcile:

1. **Merge Chemistry + When Grouped With + the Charm strip into one "Partners & Rivals" section** — one row per groupmate, a labeled *With* line (chemistry) and *Vs* line (rivals). Client-side merge by playerId; both arrays already carry it. When 83%-With and 45%-Vs sit on the same labeled row, they read as two directions of one rivalry, not a contradiction.
2. **Surface the 2v2 sub-record inside the With line** (few lines inside the existing API loop at api stats.ts:1239-1252: also tally when `decision === 'partner'`). The season slide's 4-0-1 then literally appears as a labeled subset of the drill-down's 5-1-1. Add "(2v2 only)" to the slide.
3. **Re-present Lucky Charm with its real unit**: "you avg +$9/round with him in your group (4 rounds, +$36 total)" — derivable client-side. Nemesis/Dominate dollars live in the Vs line where everything is per-hole.

```
┌─ PARTNERS & RIVALS ────────────────────────────┐
│ With = holes on the same side (2v2, 3-pack,    │
│ blind). Vs = holes on opposite sides.          │
│────────────────────────────────────────────────│
│ 🍀 LUCKY CHARM: Ben McGinnis                   │
│ You average +$9/round with him in your group   │
│ (4 rounds · +$36 total)                        │
│────────────────────────────────────────────────│
│ Matt White              6 rds together  🤝 Best│
│   With  83%  5-1-1 · 21 holes                  │
│         as 2v2 partners: 100% · 4-0-1 · 12     │
│   Vs    45%  5-6   · -$6                       │
│────────────────────────────────────────────────│
│ Ben McGinnis            4 rds together 🍀 Charm│
│   With 100%  4-0-0 · 12 holes                  │
│   Vs    50%  3-3   · +$2                       │
│────────────────────────────────────────────────│
│ Chris McNeely          5 rds together 🎯 Nemesis│
│   With  40%  2-3-0 · 15 holes                  │
│   Vs    31%  4-9   · -$14                      │
│────────────────────────────────────────────────│
│ 🤝 Best teammate (same-team win%)              │
│ 🍀 Lucky charm — best avg $/rd when grouped    │
│ 🎯 Nemesis — takes the most $ from you         │
└────────────────────────────────────────────────┘
```

**Effort: M** (web reorganization + a few-line API addition). Every existing number stays mathematically identical; this also kills the touch-dead `title=` tooltips and lifts the 8px strip into readable row text. This subsumes your option 3 and resolves the open MEMORY item properly.

---

## 4. Leave alone — already good

- **Board core:** 5s poll + freshness line, poll-surviving accordion, row-tap scorecard drill-down, scorecard density and HoleBadge notation, Group-view auto-expand, divergence-banner *behavior*, CTP/Skins/generic side-game card split.
- **Score entry:** offline queue UX, session auto-resume, single-group fast path, group picker, entry-code screen, sticky Save footer, "Nobody"-first CTP bottom sheet, the discreet escape hatches.
- **Standings:** leader spotlight, cut divider concept, rank deltas, sub section (it's the *best* version of the subs rule), pin persistence/scroll-into-view.
- **Stats:** hole-average scorecard, Round History sparklines, Batting Position grid, Highlight Reel counts, push-agnostic win% (verified consistent everywhere).
- **Champions & History:** entirely done — rail, award cards, expandable seasons, hash deep-links.
- **Pairing audit** (beyond the one-line auto-select), **global header + bottom nav**, **the two-odds-surfaces split** (futures vs The Line is conceptually correct; worth one cross-link sentence, nothing more).

Deliberately **not** recommended: the SegmentedControl extraction (the only proposal with real visual-change surface — revisit only if P4 leaves you wanting chip consistency on Stats), the Scouting tab promotion (P4 makes the control row honest enough; taste call, ask me if it still bugs you), and the Playoff Picture card (good idea, blocked on confirming playoff mechanics).

**Suggested build order:** P1 + P8 (one cleanup batch) → P3 → P6 + P7 → P5 → relationship section → P4 → P2 (prototype first).