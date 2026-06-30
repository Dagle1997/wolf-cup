# Tournament Handoff — 2026-06-23 (eve): Pete Dye money build in progress

**Trip: Pete Dye Invitational, Jun 26–27. REAL money runs through the app. "It's real. Has to work."**

---

## TL;DR

- **Prod is healthy** at `4010e46` (= origin/master). Two web fixes shipped + deployed tonight.
- **The money fix (off-the-low + handicap allowance %) is BUILT-CORE but UNCOMMITTED** — 5 files in the main working tree, golden-tested and green. Do NOT lose it. Either commit-after-review or it stays in the working tree.
- **A UI shell is in a separate git worktree** (also uncommitted).
- **The gating decision is still open: what games are actually being played at Pete Dye?** Everything below scopes off that.

---

## Git state (verified)

```
HEAD / origin/master = 4010e46  tournament-web: leaderboard scroll-off fix + hub "live now"
                       eecb40a  tournament: editable cell phone inline in the roster
                       9946a82  tournament: add cell phone to the roster (SMS-bot foundation)
```

**Committed + pushed + DEPLOYED to prod (tournament.dagle.cloud, /api/health ok):**
- Leaderboard expanded-card scroll-off fix (`table-layout: fixed`)
- Hub "Round N is live" for early-started rounds
- Cell phone on the roster (`players.phone`, migration 0021) + inline edit

**UNCOMMITTED in the main tree** (`git status` — the money build):
```
 M apps/tournament-api/src/engine/games/config-schema.ts
 M apps/tournament-api/src/engine/games/types.ts
 M apps/tournament-api/src/engine/handicap-strokes.ts
 M apps/tournament-api/src/services/games-money.ts
?? apps/tournament-api/src/engine/handicap-strokes.allowance.test.ts
```

**UNCOMMITTED in a worktree** — the allowance-% UI shell (web-only):
- Worktree: `.claude/worktrees/agent-ad7129c785bbaaa31` (branch `worktree-agent-ad7129c785bbaaa31`)
- Files: `admin.events.$eventId.lock-handicaps.tsx` (typed % input), `events.$eventId.leaderboard.tsx` ("Handicaps locked as of … at N%" line)

**Stale worktrees to clean up** (the earlier integrated workflow): `wf_e41d96c8-724-1`, `wf_e41d96c8-724-2` — their diffs are already in `4010e46`. `git worktree remove` them.

---

## The money rule (Josh-CONFIRMED + golden-APPROVED)

`CH_allowed = round(fullCH × pct/100)` (half-up), **THEN** off-the-low for Guyan 2v2.

**Golden (approved 2026-06-23):** foursome full CH 4/11/18/27 @ 80% →
allowed 3/9/14/22 → foursomeLow 3 → **off-low strokes 0/6/11/19**.

Three handicap consumers, allowance passes through ALL, off-low ONLY in the foursome game:

| Game | File | Fix | Status |
|---|---|---|---|
| Guyan 2v2 + net-skins/points-for-net modifier | `services/games-money.ts` `settleFoursome` | `round(CH×pct)` → **off foursome-low** | ✅ DONE (core) |
| Best-ball-vs-par ($50 standings) | `services/team-standings.ts` | `round(CH×pct)`, **no** off-low | ⏳ TODO |
| Separate buy-in skins | `services/sub-games.ts` → `engine/formats/skins.ts` | `round(CH×pct)`, **no** off-low | ⏳ TODO |

---

## What's DONE (uncommitted, green)

1. **Pure helper** `engine/handicap-strokes.ts` → `applyAllowanceOffLow(chByPlayer, pct)` returns `{ allowed, groupLow, offLow }`. Half-up rounding; off-low always ≥ 0; throws on empty group.
2. **`GameConfig.handicapAllowancePct?`** added to `types.ts` + `config-schema.ts` (optional → absent parses as **100**, back-compat). Lives in the resolved config → **frozen in the round pin** with zero new plumbing (`settleFoursome` already holds `pin.config`).
3. **`settleFoursome` rewired**: allocates strokes from `offLowByPlayer` (was full `ch`) at `games-money.ts:~424`.
4. **Golden test** `engine/handicap-strokes.allowance.test.ts` — 6/6 pass (encodes the approved numbers).

**Verification run:**
- New golden: 6/6 ✅
- Engine goldens: **114/114 byte-identical** ✅ (change correctly isolated to the service layer)
- games-money service tests: 36/36 ✅ — **BUT** likely because those fixtures have foursome-low = 0 (off-low is a no-op for them). The existing suite does **not** truly exercise off-low changing the money.
- `tsc --noEmit`: clean ✅

---

## REMAINING build steps (in order)

1. **A real off-low MONEY test** — fixtures where the low man ≠ 0, asserting off-low changes who wins a hole / the cents. (The current pass is not proof.)
2. **`events.handicapAllowancePct`** column + migration + `admin-event-handicaps.ts` lock route accept/store/return + **pin-writer inject** (`services/pin-round-at-start.ts`) so the UI value persists and freezes into the pin.
3. **Allowance in `team-standings.ts`** (best-ball, no off-low) + **`sub-games.ts`** skins handicaps (no off-low).
4. **Integrate the UI shell** from the worktree (the lock-handicaps % input + leaderboard "locked at N%" line). It needs the 3 backend touchpoints from step 2: accept on `/handicaps/lock`, return on the handicaps GET, populate `event.handicapAllowancePct` + `event.handicapsLockedAt` on the leaderboard GET.
5. **Adversarial review** (codex + gemini, high effort, money framing) BEFORE merge — magnitude/money discipline.
6. Typecheck + full suite + commit (by explicit path) + deploy.

---

## OPEN DECISIONS (Josh, tomorrow)

1. **🔴 What games are actually played?** Gates the whole money scope. ("I need to figure out exactly what the games are going to be.")
2. **Allowance %** — a typed box, organizer sets per event (default 100). Build is NOT blocked on a value.
3. **Skins** — Josh unsure it's even in the lineup. If played: payout = **even per skin (pot ÷ skins won)**. The built engine does per-hole + carryover (a DIFFERENT split) → would need swapping. (gross/net/gross_beats_net modes already correct.)

---

## Tomorrow's session order (2026-06-24)

1. Create event + add roster (+ phone numbers).
2. **Encrypted DB FIRST** (fresh, libsql `encryptionKey`) — must be live before the first real score Friday so trip money is born encrypted. + **SMS join-code bot** (inbound: they text our number → sender-match → code back; verifies the phone for free). See `project_tournament_security_decisions_2026_06_23` memory.
3. **Lock the game lineup** (decision #1).
4. Finish the money scope to match (remaining steps above) → review → deploy.
5. **Scouting report** from GHIN data (one-pager: last 2 @ Pete Dye, last 2 @ Guyan, handicap ↑/↓; for team-picking). See `project_feature_scouting_report` memory.

---

## Backlog (captured, not trip-critical)

- **Admin roster policing** (event-scoped first, global later): see link status, overwrite phone (done), **break a device binding / revoke** (no admin revoke endpoint exists today), re-issue code.
- Join-code hardening at scale: single-use codes, `/api/join` rate-limiting, longer codes.
- Global/saved named rosters with default rules.
- Skins payout swap to even-per-skin (only if skins is played).

---

## Decided this session (don't re-litigate)

- **Auth = Google + join code (+ invite) only. No username/password, no GHIN-login, ever.** (No credential secrets to guard.)
- **DB encryption = fresh encrypted DB tomorrow** (all pre-Friday data disposable; hard deadline before the first trip score).
- Join-code risk today is LOW (~12 live codes in an 887M space); the phone-match via the bot takes it to ~nil.
- Binding durability: `tournament_device_id` cookie (90-day) → permanent `device_bindings` row → player. User can self-unbind; **no admin revoke endpoint yet** (backlog).
