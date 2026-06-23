# Tournament UI — Expert Review vs Wolf Cup (2026-06-23)

**Brief (Josh):** "the score entry just looks so basic… why do I think Wolf looks so
good." Reviewed the live dark-mode screens (leaderboard, expanded scorecard,
score-entry) against the Wolf Cup app (`apps/web`, the gold standard) — code +
rendered pixels. **Trip Jun 26–27: the app runs full scoring + money, so this is
trip-critical, not just marketing.**

## The root cause (one sentence)
**Wolf is built on a real component system (shadcn/ui — `Button`, `Card`,
consistent radii/shadows/typography/icons); the tournament app is hand-rolled
inline `style={{}}` objects with no component layer — so every surface re-invents
its polish and drifts.** The score-entry port is the worst case: it took Wolf's
elegant **2-column compact grid + auto-advancing single-tap input + tiny
color-coded G/P/S toggles** and flattened it into a **1-column list of big cards
with −/+ steppers and big text chips.** Same data, much less craft.

## Screen-by-screen

### 1. Score-entry — **PRIORITY 1 (Josh-flagged, trip-critical)**
Wolf (`apps/web/src/routes/score-entry-hole.tsx` L1064-1180) vs the port
(`rounds.$roundId.score-entry.tsx`):
- **Layout:** Wolf = `grid grid-cols-2 gap-2` of small `border rounded-xl p-3 bg-card`
  cards → all 4 fit tight with breathing room. Port = a single column of large
  cards → tall, loose, only ~3 fit before scroll.
- **Score input:** Wolf = one clean centered `text-xl font-bold` input that
  **auto-advances to the next player on entry** (and blurs on the last to drop the
  keyboard) — fast, no chrome. Port = a big empty box flanked by 48px −/+ steppers
  → utilitarian, lots of empty pixels, the "basic" look.
- **Bonuses:** Wolf = a single "BONUSES" card (`uppercase tracking-widest` header)
  with a 2-col grid of tiny `w-8 h-8 rounded-lg` **G / P / S toggle buttons**,
  color-coded when active (greenie green / polie blue / sandie orange). Port = big
  full-width "Greenie/Polie/Sandie" *text* chips under every card → noisy, generic.
- **Color restraint:** Port outlines everything in accent green (steppers, toggle)
  → heavy. Wolf reserves color for meaning (score/money red-green; toggles colored
  only when active), neutral chrome otherwise.
- **Fix (this session):** rebuild the score grid to match Wolf — 2-col compact
  cards, clean auto-advancing input (keep the 2-digit allowance for a 10+; drop the
  steppers), a compact Bonuses card with color-coded G/P/S toggles. Tournament has
  Tailwind (v4) so the layout classes port directly; use the tournament color
  tokens (no shadcn aliases here).

### 2. Leaderboard — **already good (3-4a matched Wolf)**
The lean row (`# | Player·HCP·thru | To Par | $`, medallions, colored To-Par/$,
multi-open cards, Money-mode banner) reads cleanly and matches Wolf's board. Dark
mode is sharp. Minor: when a per-player card expands, the wide hole-grid pushes the
row's To-Par/$ off-screen — constrain the expanded grid width (P2).

### 3. Expanded scorecard (the HoleBadge grid) — **good**
The ported HoleBadge notation + Net + per-hole $ is the most polished surface in the
app (it's a near-verbatim Wolf port). Keep.

### 4. Cross-cutting (the real long-term fix)
Most other screens (money, event-home, admin) are inline-style one-offs. The durable
fix is a **small primitive set matching Wolf's shadcn polish** — `Button`
(variants + hover/active), `Card`, `Input` (focus ring), `ToggleChip`, refined type
scale — then re-compose screens from them. Tournament already started this (T11-1
tokens + a few shell primitives) but never built the interactive primitives or
rolled them out. **This is the post-trip investment that makes everything feel
"Wolf-good" by default.**

## Recommended sequencing (trip is 3 days out)
1. **Now:** score-entry rebuild to match Wolf (this session) — biggest perceived-quality
   jump, trip-critical.
2. **Trip-critical (P0, separate):** the net-basis correctness, the save-lag, the
   organizer-can-reach-score-entry path (see `backlog-prioritized-2026-06-23.md`).
3. **Post-trip:** the primitive set (Button/Card/Input/ToggleChip) + roll-out — the
   structural fix for "basic everywhere."
