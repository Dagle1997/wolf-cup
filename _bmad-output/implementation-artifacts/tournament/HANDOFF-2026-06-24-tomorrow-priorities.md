# Tournament — START HERE 2026-06-24 (priority-ranked, critical → low)

**Trip: Pete Dye Invitational, Jun 26–27 (Fri–Sat). REAL money runs through the app.**
**Today is Wed Jun 24 → ~2 days to the first real score.**

Prod is healthy at `4010e46`. The money fix is built-core but **uncommitted** in the working tree (see `HANDOFF-2026-06-23-money-build.md` for the file-level detail). Auth + encryption decisions are settled — don't re-litigate (see `project_tournament_security_decisions_2026_06_23` memory).

---

## ⚠️ Operational sequence vs. priority

Priority ≠ order. The **encrypted DB must be stood up FIRST** (before any roster/phone data is entered) so trip data is born encrypted. So even though "finish the money fix" is the highest-stakes work, the day *starts* with the DB + roster. Sequence is called out per item.

---

## 🔴 CRITICAL — trip blockers (must be done + verified before Friday's first score)

### C1. Fresh encrypted DB  ·  *do FIRST, before any roster data*
- libsql `encryptionKey` on `createClient` (`apps/tournament-api/src/db/index.ts`). Generate a strong key → VPS env `DB_ENCRYPTION_KEY` (never in git/DB).
- **Fresh DB, not a re-key** — all current + pre-Friday data is disposable (Josh). Seed re-creates demo data.
- **HARD DEADLINE: live before the first real Pete Dye score**, so trip money is born encrypted.
- Verify: app reads the encrypted file, migrations + seed run on container start.

### C2. Create event + build roster (+ phone numbers)  ·  *into the encrypted DB*
- Prerequisite for the bot, scouting report, and real money testing.
- Phone field + inline edit already shipped (`players.phone`, migration 0021).

### C3. Lock the GAME LINEUP  ·  *Josh decision — gates C4*
- "I need to figure out exactly what the games are going to be."
- The money build assumes Guyan 2v2 + best-ball-vs-par + maybe skins. **Until this is locked, C4's scope is unknown.**
- Sub-decisions: allowance % (typed box, default 100 — build NOT blocked on a value); is skins in the lineup? (if yes → even-per-skin payout, see money-build handoff).

### C4. Finish the money fix to match the lineup  ·  *the core is built/uncommitted*
Remaining (full detail in `HANDOFF-2026-06-23-money-build.md`):
1. A **real off-low money test** (current pass is not proof — fixtures have low=0).
2. `events.handicapAllowancePct` column + migration + lock-route accept/store/return + **pin-writer inject** (freeze into the pin).
3. Allowance in `team-standings.ts` (best-ball) + `sub-games.ts` skins.
4. Integrate the **UI shell** (worktree `agent-ad7129c785bbaaa31`).
5. **Adversarial review** (codex + gemini, high effort, money framing) BEFORE merge.
6. Typecheck + full suite + commit (explicit paths) + deploy.

---

## 🟠 HIGH — wanted for the trip, not a settlement blocker

### H1. SMS join-code bot  ·  *after roster (C2)*
- **Inbound model** (decided): player texts our number → bot matches sender # against `players.phone` → texts their code back; "not found → text Josh." Verifies the phone for free.
- Risk: Twilio number provisioning / A2P verification has lead time (inference) — may not clear by Friday.
- **Zero-dependency fallback:** organizer texts codes manually by copy-paste from the roster/join-codes screen. So the trip is never blocked on the bot.

---

## 🟡 MEDIUM — useful, not required

### M1. Scouting report  ·  *after roster + GHIN (C2)*
- One-pager per player: last 2 rounds @ Pete Dye, last 2 @ Guyan, handicap ↑/↓ — to help pick teams (group hasn't decided how).
- Handicap trend is ~free (we already pull GHIN history for the lock). "Last 2 @ [course]" needs GHIN posted-score history by course — confirm the data shape once the roster's in. (`project_feature_scouting_report` memory.)

---

## 🟢 LOW — backlog, explicitly NOT this trip

- **L1. Admin roster policing** (event-scoped first, global later): link status, overwrite phone (done), **break/revoke a device binding** (no admin revoke endpoint exists today), re-issue code.
- **L2. Join-code hardening at scale**: single-use codes, `/api/join` rate-limiting, longer codes. (Risk today is LOW — ~12 live codes in an 887M space.)
- **L3. Global / saved named rosters** with default rules.
- **L4. Skins payout swap** to even-per-skin (pot ÷ skins won) — only if skins is actually played; built engine does per-hole + carryover.
- **L5. Score-entry UX port** (+/- steppers, auto-advance, hole nav) — see `project_score_entry_ux_overhaul_feedback`.
- **L6. Post-trip: delete phone numbers** once the bot no longer needs them.

---

## Settled this session (do NOT re-open)

- **Auth = Google + join code (+ invite) only.** No username/password, no GHIN-login, ever.
- **DB encryption = fresh encrypted DB** tomorrow (pre-Friday data disposable).
- **Skins (if played) = even per skin** (pot ÷ skins won).
- Binding durability: 90-day cookie → permanent `device_bindings` row → player; user can self-unbind; no admin revoke yet (→ L1).

---

## First move tomorrow

C1 (encrypt the fresh DB) → C2 (create event + roster + phones) → then C3/C4 (lineup + money) with H1 (bot) in parallel once the roster exists. The money core is already written and golden-green — C4 is finish + test + review, not start-from-scratch.
