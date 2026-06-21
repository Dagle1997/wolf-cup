# Pete Dye brochure — screenshot capture runbook

The brochure (`pete-dye-marketing.html` → `Pete-Dye-Invitational-The-App.pdf`) pulls four
phone screenshots from `reference/tournament-screenshots/`. This is how to refresh them from
the **current master UI** with a made-up roster (no Wolf Cup names), including the
**Cuban / Johnny Hotdog** easter egg.

Run this only when:
- the tournament UI is settled (master pushed), **and**
- the other instance's dev servers are **down** (this harness needs :5173 web + :3000 api,
  and the vite proxy is hard-pinned to `localhost:3000`).

## The made-up roster (easter egg baked in)

Foursome, in slot order (slots 1&2 = Team A, slots 3&4 = Team B):

1. **Cuban**          ← becomes the "(you)" perspective on score/leaderboard/my-money
2. **Johnny Hotdog**  ← Team A with Cuban
3. Alex Carter        ← Team B (neutral made-up; swap to a real opponent if desired)
4. Sam Rivera         ← Team B

Team A = **Cuban & Johnny Hotdog** — i.e. David Miller's two alter egos as a 2-man team
(the three-headed-monster bit). David himself doesn't appear as a separate player; he *is*
the personas. So Foursome results read: **Cuban & Johnny Hotdog vs Alex Carter & Sam Rivera**,
and the leaderboard shows **"Cuban (you)"**. Pairs with the Long Drive easter egg on page 8.
HI/handicap numbers are whatever the seed assigns — fine to keep.

Event name: **Pete Dye Invitational** · Course: **Pete Dye Golf Club**

## Go-time procedure

1. **Transient seed tweak** — in `apps/tournament-api/src/db/e2e-seed.ts`, change three values
   (revert after capture; do NOT commit):
   - `const memberNames = ['Cuban', 'Johnny Hotdog', 'Alex Carter', 'Sam Rivera'];`
   - event `name:` `'E2E Cup'` → `'Pete Dye Invitational'`
   - course `name:` `'Guyan Golf & Country Club'` → `'Pete Dye Golf Club'`, `clubName:` `'Guyan'` → `'Pete Dye'`
   - (optional, nicer dates) `startDate`/`endDate` → Jun 26–27, 2026

2. **Capture** — from repo root, with the other instance's servers stopped:
   ```
   pnpm --filter @tournament/web exec playwright test screenshots.spec.ts
   ```
   This seeds a throwaway DB, boots web+api, scores 3 holes, and writes PNGs to
   `apps/tournament-web/e2e/.tmp/shots/`.

3. **Swap + re-render** — copies the 4 brochure shots into place and rebuilds the PDF:
   ```
   node reference/swap-and-render.mjs
   ```

4. **Revert** the `e2e-seed.ts` tweak (`git checkout apps/tournament-api/src/db/e2e-seed.ts`).

## Shot → brochure slot mapping

| brochure slot (`reference/tournament-screenshots/`) | e2e shot (`e2e/.tmp/shots/`) | brochure page |
|---|---|---|
| `hub.png`              | `15-event-home-live.png` | p2 (cropped to hide the activity feed) |
| `leaderboard.png`     | `09-leaderboard.png`     | p3 |
| `foursome-results.png`| `14-foursome-results.png`| p4 (cropped window) |
| `money.png`           | `11-money.png`           | p5 (cropped window) |

The hub + money + foursome shots are shown in fixed-height crop windows in the HTML, so the
bottom of each tall screenshot (incl. any raw activity-feed rows) is not visible — no manual
cropping needed.
