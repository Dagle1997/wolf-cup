# Tournament App — UI/Design Review (Fable, 2026-06-12)

Mobile-first (390px phone viewport). Reviewed 14 rendered screenshots end-to-end
(`apps/tournament-web/e2e/.tmp/shots/`, capturable via `e2e/screenshots.spec.ts`)
plus `index.css` tokens, `page-shell.tsx`, `global-nav.tsx`, the score-entry
route, the leaderboard route, and `head-to-head-card.tsx`. All proposals build on
the existing token system + PageShell primitives — no framework change, no rewrite.

---

## 1. Overall verdict

Functionally complete but visually a wireframe wearing default styles: generic
blue brand, white-on-white with no page background, no spacing/radius/shadow
system, and several screens (score entry, invite, pairings) that bypass PageShell
and render raw unstyled controls. The biggest gap: **the most-used screen — score
entry — is the least designed.** Fixing the token layer + that one screen
transforms perceived quality across the product. There are also two genuine layout
**bugs** that read as "broken," not "basic": the create-event wizard label/input
misalignment and the leaderboard header cramming — plus a literal missing-space
("Hole 4All synced") on score entry.

---

## 2. Design-system upgrades (token-level, `src/index.css`)

**2a. Golf color identity — replace generic blue with fairway green + warm accent**
```css
--color-brand-primary: #166534;   /* fairway green (green-800), 7.4:1 on white */
--color-brand-strong:  #14532d;   /* pressed/active + dark headings */
--color-brand-tint:    #f0fdf4;   /* selected-state tint (green-50) */
--color-accent:        #b45309;   /* warm sand/amber-700 — badges, press fired, live */
--color-surface-sunken:#f1f5f9;   /* PAGE background on body; cards (#fff) finally pop */
--color-money-pos:     #15803d;
--color-money-neg:     #b91c1c;
```
Everything consuming `--color-brand-primary` inherits the new identity for free.

**2b. Spacing / radius / elevation (missing entirely today)**
```css
--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px; --space-7:48px;
--radius-sm:6px; --radius-md:10px; --radius-lg:16px;
--shadow-card:0 1px 3px rgb(15 23 42 /.08),0 1px 2px rgb(15 23 42 /.04);
--shadow-raised:0 4px 12px rgb(15 23 42 /.15);
```
Add a real `.card` class (score-entry already emits `className="card"` with **no CSS behind it**).

**2c. Typography** — ramp stops at 1.25rem (no display size → titles look like body). Add `--font-xl:1.5rem` (titles), `--font-2xl:2.25rem` (hole number, scores, money totals). **Keep the system font** (SF Pro/Roboto read great outdoors, zero bytes in an offline PWA). Add `font-variant-numeric: tabular-nums` on all tables/scores/money (fixes wobbly columns); weight discipline 400/600/700/800.

**2d. Form-control + touch-target standards** — bump base control height 44→48px (`--control-height-lg:56px` for CTAs/steppers), 3px focus ring (sunlight), visible `:active` pressed state. **The base `input` is `display:inline` — this is the direct cause of the wizard's broken layout**; change to block-level full-width label/input. **Add base `th/td` padding** — none today, which is why the leaderboard header renders `HCPThruGrossNetSkins`.

---

## 3. Per-screen notes (highlights)

- **01 Invite** (every guest's first impression, zero-styled): brand-green header with event name large; name buttons → full-width 56px cards with initial-letter avatars. The one screen a 70-year-old must not fumble.
- **02 Event home**: `.card` + an icon per destination; replace "You're in, **friend**." (placeholder leaked to prod) with the real name + green check; make "Round in progress" a hero banner with a direct **"Enter scores →"** CTA; separate Admin tools; **confirm the rainbow devtools FAB (visible on every screen) is dev-only**.
- **03 Admin landing**: group 8 identical cards into "Run the round / Setup / Courses & events"; Start round first + brand-colored; merge the two "New course" cards.
- **04 Create-event wizard — LAYOUT BUG**: labels detached from inputs (inline-flow base CSS). §2d fix repairs it app-wide. Also: auto-detect timezone (hide the raw IANA field), add 3-dot progress, full-width Next.
- **05 Pairings — worst overflow**: second select clipped off-screen; redesign as **one card per foursome, players stacked vertically**; label/cut the 📍 cells; make Save the only primary.
- **06 Who can score?** — closest to done; wrap radios in full-card tap targets (selected = brand-tint + green border); sticky Save.
- **07 Start round**: show the foursome roster above each scorer select for context; big green 56px CTA + confirm.
- **08 SCORE ENTRY — priority redesign** (see §3b below).
- **09 Leaderboard**: base `th/td` fix; map `in_progress` enum → status pill ("● Live"/"Final"); rank medallions for top 3 + brand-tint on viewer's row; scope `<select>` → 2-button segmented control; hide Skins column until non-null.
- **10 My Money**: lead with one huge signed net total before the per-game list.
- **11 Money matrices**: cut the 3-sentence explainer to one line + disclosure; color cells green/red/neutral; first-name+last-initial in the matrix; make **Combined (settle)** the headline.
- **12 Settle Up**: today it never says **who pays whom** (its whole job) — lead with "Ronnie pays Matt $12.50" cards, demote the pairwise grid.
- **13 Bets / 14 Foursome results**: align on EmptyState primitive + icon; Bets empty → organizer-only "Add a bet" CTA, not telling players about an admin they can't reach.

### 3b. SCORE ENTRY redesign (the on-course screen — dozens of taps/round, one-handed, sunlight)

Current problems (from shot + code): no header/shell; "Hole 4All synced" (two spans, no separator — a literal bug, ~line 1347); plain inline par/SI; raw `type=text` inputs; placeholder-only "Putts" (vanishes on entry — worst for older users); 2-col grid orphans the 3rd player; handoff + press buttons sit *above* the scores; Save is a small gray disabled button mid-page.

Proposed top-to-bottom:
1. **Sticky hole header**: "HOLE 4" at `--font-2xl`/800 brand-green, "Par 4 · SI 7 · 385 yds" beneath; sync chip as a real pill (✓ Synced / ⏳ N queued); a single **⋯ overflow** opening a bottom sheet with *Hand off scorer / Press / Skip hole* (once-or-twice-a-round actions must not outrank the 18×-a-round one).
2. **One full-width row per player** with a **stepper `− [ 4 ] +`** (56×56 buttons, score at `--font-2xl` tabular). First "+" seeds par (course data already in hand). Tint the number vs par (green under / slate even / amber over). **Steppers beat text inputs here**: no keyboard occluding half the screen, no glove/sweat mistypes, and they make the load-bearing iOS keyboard-focus hack unnecessary. Keep tap-number→numeric-keypad as the 10+ fallback (preserves the existing input path).
3. **Putts**: small secondary stepper / segmented `0/1/2/3+`, behind a per-round "Track putts" toggle; always a visible label, never placeholder-only.
4. **Sticky bottom Save bar** (`--shadow-raised`, safe-area inset): full-width 56px green "Save Hole 4" with live "2 of 3 entered" progress replacing the detached requirement line; disabled = green at 40% + the reason. Bottom-anchored = thumb-reachable.
5. **Hole progress strip** (18 dots: filled=scored, ring=skipped, solid=current) — orientation without building hole-editing.
6. **Press control**: render real pairing names ("Press: **Matt & Ronnie**"), accent-amber fired state with visible Undo window.

---

## 4. Accessibility & outdoor readability

Green-800 brand = 7.4:1 (beats current blue). Audit `--color-text-muted #555` (4.6:1 — bump for <16px). Money color never the only signal (keep +/− sign). Nothing interactive/numeric below 16px (also prevents iOS auto-zoom). Prefer weight/size over hue in sunlight; 3px focus rings; solid fills for primary; `--color-surface-sunken` page bg survives glare better than hairlines. Per-hole actions in the bottom two-thirds; respect `env(safe-area-inset-bottom)`. 48px hit-area floor (raw radios + date pickers are current violators). Install-to-score gate: numbered visual steps + keep "View leaderboard instead" as a styled secondary. Status with glyphs (✓/⏳), not color alone.

---

## 5. Phased roadmap

**Phase 1 — Foundation + score entry (small, shippable, biggest visible win)**
1. `index.css`: brand-green swap + `--color-accent` + `--color-surface-sunken` on body + spacing/radius/shadow + `--font-xl/2xl` + tabular-nums + base `th/td` padding + block-level label/input + button `:active` + `.card`. *One CSS ticket — every screen improves instantly; also fixes the wizard + leaderboard bugs as side effects.*
2. Score-entry redesign (sticky header incl. the string-fix, stepper rows, sticky Save bar, ⋯ sheet, progress strip).
3. Invite-claim page treatment (tiny ticket, outsized first-impression ROI).
4. Confirm devtools FAB excluded from production.

**Phase 2 — Data screens**: leaderboard (pills, medallions, self-highlight, segmented scope, conditional Skins); money/my-money/settle (hero totals, colored cells, who-pays-whom cards); event home (live-round hero, icons, real name).

**Phase 3 — Polish**: pairings stacked cards; admin grouping; wizard progress + tz auto-detect; start-round context + confirm; empty-state icon pass; install-gate steps; press team names. Optional: self-hosted Inter; dark "twilight" theme (the `dark` custom-variant hook already exists, unused).

**Process note:** several screens were captured in empty/zero states; before Phase 2, capture a fuller screenshot matrix (populated money, fired press, offline chip) so data screens are designed against real states.
