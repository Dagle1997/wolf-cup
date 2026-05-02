# Offline Scorer Drill (T5-10)

> **When to run this:** Run this drill once **per scoring device per Event**, **BEFORE** the Event starts. A successful drill clears the NFR-R2 (offline-merge correctness) gate for that device. Devices failing steps 4–7 are **BLOCKED** from scoring at that Event; either fix the issue OR transfer the scorer assignment to a verified device via T5-7's `POST /api/rounds/:roundId/scorer-assignments/transfer` endpoint.

---

## Setup (read before starting)

- **Environment:** `https://tournament.dagle.cloud` (production). Drilling against staging would not catch prod-specific config drift.
- **Test round provisioning:** the organizer pre-creates a "drill round" using T3-2's event-creation wizard. Naming convention: `Drill {YYYY-MM-DD} {device label}`. The executing device's player MUST be a foursome member AND the assigned scorer of that foursome. After the drill completes, the organizer cancels the drill round via T5-8's `POST /api/rounds/:roundId/cancel` endpoint so it doesn't pollute leaderboards.
- **Platform:** **iOS Safari only** for v1. Pinehurst-trip device roster is all iOS. Android validation is Followup T5-10e (post-Pinehurst). Other browsers on iOS (Chrome, Firefox) are NOT supported — the PWA install path is iOS-Safari-specific.
- **Time budget:** ≤10 minutes per device.
- **Roles:**
  - **Scorer (the device under test):** runs steps 1–6.
  - **Organizer or developer (separate person, may be remote):** runs step 7 (audit verify) using VPS access.
  - The organizer should be reachable during the drill for steps 1, 6 (second-device check), and 7.

---

## Step 1 — PWA install verify

1. Open `https://tournament.dagle.cloud` in iOS Safari (NOT Chrome / Firefox).
2. Tap the Share menu (square with up-arrow at the bottom).
3. Tap "Add to Home Screen". Confirm the app name + icon.
4. Tap the new tournament icon on the home screen.
5. Verify the app launches in **standalone mode** (no Safari URL bar / chrome at the top).

**Pass criteria:** standalone mode confirmed.
**Fail action:** the device is BLOCKED. Stop here. Either fix the iOS install path OR reassign scorer role to a verified device (T5-7).

---

## Step 2 — Online open + cache verify

1. Sign in with Google OAuth (Cassador or league Google account).
2. Navigate to the drill round's score-entry page.
3. Tap the "next hole" arrow once to advance to hole 2.
4. Verify the scorecard shell renders: cell layout for 4 players, course par + SI visible, hole number displayed.

**Pass criteria:** scorecard shell + course data both visible.
**Fail action:** report to organizer; T5-4 cache may be misconfigured for this device.

---

## Step 3 — Airplane mode

1. Open iOS **Settings** app.
2. Toggle **Airplane Mode** ON. (Do NOT just toggle Cellular off — cellular-off keeps wifi alive on some configs and defeats this test. The Airplane Mode button is the load-bearing gate.)
3. **Verify offline state** — primary check: switch back to the tournament PWA on the home screen, navigate to the score-entry page, and confirm the in-app offline indicator (chip or badge) is visible.
   - **Secondary check (optional):** open Safari (NOT the PWA) and try to load `https://example.com`. If Safari shows "no internet connection" / "cannot connect", offline is confirmed. If example.com loads, wifi is still active — return to iOS Settings and re-toggle Airplane Mode.
   - Note: hard-refreshing the PWA itself is NOT a reliable offline indicator (the page may render from the round-cache while online OR offline; cache hit alone proves nothing).

**Pass criteria:** in-app offline indicator visible (and, if checked, example.com fails to load).

---

## Step 4 — Offline scoring

1. Stay on the drill round's score-entry page.
2. Score **3 consecutive holes** for **all 4 players in the foursome** (12 cells total). For each hole: enter gross strokes (any plausible value, e.g., 4–6) for each player + tap Save.
3. Verify the on-screen "queued" indicator increments — should reach **12** after all 12 cells are entered.
4. Persistence check: close the PWA (swipe up + away). Reopen from the home screen. Navigate back to the drill round. The "queued" indicator should still show 12 cells (queue is IndexedDB-backed; survives PWA restart).

**Pass criteria:** queued indicator = 12 + cells survive PWA restart.
**Fail action:** offline queue is broken; report to organizer; do NOT proceed.

---

## Step 5 — Disable airplane mode

1. Open iOS Settings app.
2. Toggle **Airplane Mode** OFF.
3. Wait for cellular signal to re-acquire (≤30s typical at Pinehurst).

**Pass criteria:** signal bars + LTE/5G indicator return.

---

## Step 6 — Verify drain (≤30s, NFR-P2 envelope)

After step 5 you were in iOS Settings. **Switch back to the tournament PWA on the home screen** before starting the verification below.

**Two paths:**

### Preferred — with second online device

1. On the SECOND device (organizer's laptop, phone, or tablet — must be online and signed in as an event participant), navigate to the drill round's leaderboard.
2. Within **30s of step 5**, verify all 12 cells appear in the leaderboard table (4 players × 3 holes new gross totals).

**Pass criteria:** all 12 cells visible on the second device within 30s.

### Fallback — single-device drill

If no second device is available:

1. On the SAME drilling device, observe the "queued" indicator drops to 0 / "all synced" within 30s.
2. Open the leaderboard tab (still on the same device). The 12 cells should be visible.

**Pass criteria:** queue drains to 0 + same-device leaderboard shows 12 cells.
**Caveat:** the single-device path doesn't prove cross-device propagation. The executor MUST note "single-device drill — no cross-device propagation verified" in the drill record's "Issue notes" (below).

---

## Step 7 — Audit verify (organizer / developer task)

> The drilling scorer typically does NOT have audit-log access. This step is performed by the organizer or a developer with VPS/SSH access to Hostinger AFTER step 6 succeeds. The drilling scorer marks step 7 as "Pending — awaiting organizer verification" until completed.

On the operator's VPS (use the host + SSH credentials from the operator's internal SOP — NOT documented in this public-eligible drill checklist), run:

```bash
docker exec wolf-cup-api sqlite3 /data/tournament.db \
  "SELECT count(*) FROM audit_log WHERE event_type='score.committed' AND entity_id IN (SELECT id FROM hole_scores WHERE round_id='<DRILL_ROUND_ID>');"
```

**Expect:** exactly `12`. Then:

```bash
docker exec wolf-cup-api sqlite3 /data/tournament.db \
  "SELECT count(*) FROM score_corrections WHERE round_id='<DRILL_ROUND_ID>';"
```

**Expect:** `0` (no corrections needed during a clean drill).

**Pass criteria:** 12 audit rows + 0 correction rows.
**Fail action:** the drill FAILS the device for that Event. Investigate which cells failed to audit; the device is BLOCKED until reproduced + fixed.

> **Followup T5-10b:** ship a `GET /api/admin/audit-log/round/:roundId` endpoint that the organizer can hit from a phone to eliminate SSH access from the drill loop. Out of v1 scope.

---

## Drill record

> Fill in below after the drill completes. File the completed record at `reference/drills/<eventId>/<deviceLabel>.md` per Followup T5-10a (the first drill executor will need to create the `reference/drills/` directory; that's a SHARED-path edit requiring per-commit approval).

```
- Executor: ____________
- Device: ____________ (e.g., "iPhone 14 Pro, iOS 18.4, Safari 18.4")
- Drill date: ____________
- Tournament commit SHA: ____________ (run `git -C wolf-cup rev-parse HEAD` against your local clone)
- Target Event id: ____________
- Drill round id (created in Setup): ____________

- Step results:
  1. PWA install:                  [Pass / Fail / N/A]
  2. Online open + cache:          [Pass / Fail]
  3. Airplane mode:                [Pass / Fail]
  4. Offline scoring:              [Pass / Fail]   queued count after step 4: ___ cells
  5. Disable airplane mode:        [Pass / Fail]
  6. Verify drain:                 [Pass / Fail]   path used: [Preferred / Fallback]   drain elapsed: ___s
  7. Audit verify:                 [Pass / Fail / Pending]   audit row count: ___   score_corrections row count: ___

- Overall: [Pass / Partial-Pass / Fail]
- Issue notes: ____________
- Filed at: reference/drills/<eventId>/<deviceLabel>.md
```

---

## After the drill

The organizer reviews the drill record:

- **Pass:** clear the device for scoring at the target Event. File the record per Followup T5-10a.
- **Partial-Pass (e.g., single-device drill, no cross-device verification):** acceptable if no other path exists, BUT the device MUST be paired with an online "watcher" device during the actual Event so the organizer can confirm propagation in real-time.
- **Fail:** the device is BLOCKED from scoring. Either reassign scorer to a verified device (T5-7 transfer endpoint) or reproduce + fix the failure mode.

After the Event ends, the organizer cancels the drill round via:

```bash
curl -X POST 'https://tournament.dagle.cloud/api/rounds/<DRILL_ROUND_ID>/cancel' \
  -b 'tournament_session=<organizer_session_cookie>'
```

This keeps drill data out of leaderboards.
