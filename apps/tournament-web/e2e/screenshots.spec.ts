/**
 * UI-review screenshot capture (not a regression test). Walks every key screen
 * at a phone viewport against the seeded harness and writes PNGs to
 * e2e/.tmp/shots/ for a design review. Run: `pnpm exec playwright test
 * screenshots.spec.ts`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  API_URL,
  FAKE_STANDALONE_INIT,
  authAsOrganizer,
  authAsSession,
  readHandoff,
  type Handoff,
} from './_fixture';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.tmp', 'shots');
const PHONE = { width: 390, height: 844 }; // iPhone 14-ish

async function shot(context: BrowserContext, url: string, name: string): Promise<void> {
  const page = await context.newPage();
  await page.setViewportSize(PHONE);
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(600); // let queries settle
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });
  await page.close();
}

test('capture UI screenshots at phone viewport', async ({ browser, playwright }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const fx: Handoff = readHandoff();

  // --- anon: invite ---
  const anon = await browser.newContext({ viewport: PHONE });
  await shot(anon, `/invite/${fx.inviteToken}`, '01-invite');
  await anon.close();

  // --- organizer: admin surfaces (before starting the round) ---
  const org = await browser.newContext({ viewport: PHONE });
  await authAsOrganizer(org, fx.sessionId);
  await shot(org, `/events/${fx.eventId}`, '02-event-home');
  await shot(org, `/admin/events/${fx.eventId}`, '03-admin-landing');
  await shot(org, `/admin/events/new`, '04-event-new-wizard');
  await shot(org, `/admin/events/${fx.eventId}/pairings`, '05-pairings');
  await shot(org, `/admin/events/${fx.eventId}/scorer-policy`, '06-scorer-policy');
  await shot(org, `/admin/events/${fx.eventId}/start-round`, '07-start-round');

  // --- start the round + score 3 holes (so data-bearing pages aren't empty) ---
  const api = await playwright.request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { cookie: `tournament_session=${fx.sessionId}` },
  });
  const startRes = await api.post(`/api/admin/event-rounds/${fx.eventRoundId}/start`, {
    data: { scorers: [{ foursomeNumber: 1, scorerPlayerId: fx.scorerPlayerId }] },
  });
  const { roundId } = (await startRes.json()) as { roundId: string };
  const scorerApi = await playwright.request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { cookie: `tournament_session=${fx.scorerSessionId}` },
  });
  // Post a player self-serve Action bet BEFORE scoring (the placement cutoff
  // closes betting once an in-scope hole is scored) so the Action board shot
  // below isn't empty. The scorer is a roster member + side-A stakeholder.
  const oppId = fx.memberIds.find((id) => id !== fx.scorerPlayerId) ?? fx.memberIds[0];
  await scorerApi.post(`/api/events/${fx.eventId}/action-bets`, {
    data: {
      eventRoundId: fx.eventRoundId,
      betType: 'h2h',
      basis: 'net',
      holeScope: 'full18',
      stakeCents: 2000,
      sideA: { stakeholderPlayerId: fx.scorerPlayerId, subjectPlayerId: fx.scorerPlayerId },
      sideB: { stakeholderPlayerId: oppId, subjectPlayerId: oppId },
      visibility: 'event_wide',
    },
  });
  for (let h = 1; h <= 3; h++) {
    for (let i = 0; i < fx.memberIds.length; i++) {
      await scorerApi.post(`/api/rounds/${roundId}/holes/${h}/scores`, {
        data: { playerId: fx.memberIds[i], grossStrokes: 4 + ((h + i) % 3), clientEventId: `shot-${h}-${i}` },
      });
    }
  }
  await org.close();

  // --- scorer: score-entry (installed-PWA faked) ---
  const scorer = await browser.newContext({ viewport: PHONE });
  await authAsSession(scorer, fx.scorerSessionId);
  await scorer.addInitScript(FAKE_STANDALONE_INIT);
  await shot(scorer, `/rounds/${roundId}/score-entry`, '08-score-entry');

  // --- participant: the read surfaces (now with data) ---
  await shot(scorer, `/events/${fx.eventId}/leaderboard`, '09-leaderboard');
  await shot(scorer, `/events/${fx.eventId}/my-money`, '10-my-money');
  await shot(scorer, `/events/${fx.eventId}/money`, '11-money');
  await shot(scorer, `/events/${fx.eventId}/settle-up`, '12-settle-up');
  await shot(scorer, `/events/${fx.eventId}/bets`, '13-bets');
  await shot(scorer, `/events/${fx.eventId}/action`, '16-action'); // The Action board + post-a-bet
  await shot(scorer, `/events/${fx.eventId}/event-rounds/${fx.eventRoundId}/foursome-results`, '14-foursome-results');
  // Event home AGAIN, now that a round is in progress — shows the live CTA.
  await shot(scorer, `/events/${fx.eventId}`, '15-event-home-live');
  await scorer.close();

  expect(true).toBe(true);
});
