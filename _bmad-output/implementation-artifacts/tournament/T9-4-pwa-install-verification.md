# T9-4 — Per-Scorer-Device PWA Install Verification (resurrected by T14-5)

Score entry **requires the installed PWA** (standalone), because the IndexedDB offline queue + reliable background sync are unreliable in an iOS Safari tab (FR-E9, enforced at `score-entry.tsx:477`). A scorer in a plain tab correctly sees "Install to score" and CANNOT enter scores. So every scorer device must be verified installed BEFORE play. One row per device.

## Procedure (per device)
1. Open `tournament.dagle.cloud` in the device browser.
2. Install:
   - **iOS Safari:** Share → Add to Home Screen → open from the home-screen icon.
   - **Android Chrome:** Install prompt / ⋮ → Install app → open the installed app.
3. Confirm it launches **standalone** (no browser chrome / address bar).
4. Sign in (Google) or claim via invite link.
5. Navigate to the scorer's foursome score-entry → confirm the **score form renders** (NOT the "Install to score" card, NOT "not available to you").
6. Enter + save one test score → "All synced". (Remove the test score after, or use a throwaway round.)
7. Quick offline check: Airplane Mode → score → "queued" → reconnect → "All synced".

## Device log

| Device / owner | OS + browser | Installed standalone | Reaches score form | Offline drill | Notes |
|----------------|--------------|----------------------|--------------------|---------------|-------|
|                |              | ☐                    | ☐                  | ☐             |       |
|                |              | ☐                    | ☐                  | ☐             |       |
|                |              | ☐                    | ☐                  | ☐             |       |
|                |              | ☐                    | ☐                  | ☐             |       |

## Gotchas
- **Stale bundle after a deploy:** the first standalone open post-deploy may serve the old service worker; one swipe-down refresh fixes it permanently. Absence of the "new version" toast ≠ freshness.
- **"Not available to you" despite installed:** the signed-in player isn't a member of a pairing for this round (or is the organizer-as-scorer case, T13-3). Verify roster + pairing membership.
