/**
 * First real-browser E2E for tournament-web (T14-1). Drives the critical
 * paths that jsdom/unit tests cannot reach, against a real api + real session:
 *
 *   1. Invite-claim   — public first-arrival flow + device binding (no SSO).
 *   2. Start round    — organizer picks a per-foursome scorer and starts.
 *   3. Score + offline — enter a hole online, then enter another OFFLINE and
 *                        confirm the IndexedDB queue holds it and drains on
 *                        reconnect, with the score reaching the server.
 *
 * Serial: step 2 creates the round that step 3 scores.
 */
import { test, expect } from '@playwright/test';
import {
  API_URL,
  FAKE_STANDALONE_INIT,
  authAsOrganizer,
  authAsSession,
  readHandoff,
  type Handoff,
} from './_fixture';

let fx: Handoff;
let startedRoundId: string;

test.beforeAll(() => {
  fx = readHandoff();
});

test.describe.configure({ mode: 'serial' });

test('invite-claim: anonymous visitor registers their device by tapping a name', async ({
  browser,
}) => {
  const context = await browser.newContext(); // no session cookie — anonymous
  const page = await context.newPage();

  await page.goto(`/invite/${fx.inviteToken}`);
  await expect(page.getByRole('heading', { name: /You're invited/ })).toBeVisible();

  const name = fx.memberNames[0]!;
  await page.getByRole('button', { name }).click();

  await expect(page.getByRole('heading', { name: `Welcome, ${name}!` })).toBeVisible();
  await context.close();
});

test('start-round: organizer designates a scorer and starts scoring', async ({ browser }) => {
  const context = await browser.newContext();
  await authAsOrganizer(context, fx.sessionId);
  const page = await context.newPage();

  await page.goto(`/admin/events/${fx.eventId}/start-round`);

  // The seeded round (one locked foursome) is startable.
  const section = page.getByTestId(`start-round-${fx.eventRoundId}`);
  await expect(section).toBeVisible();

  // Designate a logged-in foursome member as the scorer (the realistic path),
  // then start the round.
  await page
    .getByTestId(`scorer-${fx.eventRoundId}:1`)
    .selectOption(fx.scorerPlayerId);
  await page.getByTestId(`start-btn-${fx.eventRoundId}`).click();
  // Start is a one-way action → confirm before it posts.
  await page.getByTestId(`confirm-start-${fx.eventRoundId}`).click();

  // Navigates to score-entry for the new round.
  await page.waitForURL(/\/rounds\/[^/]+\/score-entry/);
  const m = /\/rounds\/([^/]+)\/score-entry/.exec(page.url());
  expect(m).not.toBeNull();
  startedRoundId = m![1]!;
  await context.close();
});

test('score-entry + offline queue: a score entered offline survives and drains to the server', async ({
  browser,
}) => {
  expect(startedRoundId, 'start-round test must have run first').toBeTruthy();

  const context = await browser.newContext();
  await authAsSession(context, fx.scorerSessionId); // the designated foursome-member scorer
  await context.addInitScript(FAKE_STANDALONE_INIT); // pass the installed-PWA gate
  const page = await context.newPage();

  await page.goto(`/rounds/${startedRoundId}/score-entry`);

  // The standalone fake must defeat the install gate → the real form renders.
  await expect(page.getByTestId('score-entry-form')).toBeVisible();
  await expect(page.getByTestId('install-required')).toHaveCount(0);
  await expect(page.getByTestId('current-hole')).toHaveText('Hole 1');

  // --- Enter hole 1 OFFLINE: the save must enqueue to IndexedDB, not error. ---
  await context.setOffline(true);
  // Fill every foursome member's score (the seed now builds a full foursome).
  for (let i = 0; i < fx.memberIds.length; i++) {
    await page.getByTestId(`score-input-${i}`).fill(String(4 + (i % 3)));
  }
  await page.getByTestId('save-button').click();
  // The sync chip reports pending mutations held in the offline queue.
  await expect(page.getByTestId('sync-chip')).toContainText('queued');
  // And crucially NOT a hard save error — offline is a normal, handled state.
  await expect(page.getByTestId('save-error')).toHaveCount(0);

  // --- Reconnect: the queue drains and the score reaches the server. ---
  await context.setOffline(false);
  await expect(page.getByTestId('sync-chip')).toHaveText('All synced', { timeout: 15_000 });

  // Verify server-side via the API with the scorer's session — the offline
  // score actually landed (proves enqueue → drain → server, end to end).
  const res = await context.request.get(
    `${API_URL}/api/events/${fx.eventId}/leaderboard`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    rows: Array<{ playerId: string; throughHole: number | null }>;
  };
  const scored = body.rows.filter((r) => (r.throughHole ?? 0) >= 1);
  expect(
    scored.length,
    'a player is through hole 1 (offline score drained to server)',
  ).toBeGreaterThanOrEqual(1);

  await context.close();
});

test('scorer policy: a non-active foursome member taps "I\'ll score" to take over (T13-4)', async ({
  browser,
}) => {
  expect(startedRoundId, 'start-round test must have run first').toBeTruthy();

  // scorer2 is a foursome member but NOT the active scorer (that's scorer #1).
  const context = await browser.newContext();
  await authAsSession(context, fx.scorer2SessionId);
  await context.addInitScript(FAKE_STANDALONE_INIT);
  const page = await context.newPage();

  await page.goto(`/rounds/${startedRoundId}/score-entry`);

  // Default 'foursome' policy → they see the read-only state + an "I'll score"
  // button (NOT the score form yet).
  await expect(page.getByTestId('read-only')).toBeVisible();
  const claim = page.getByTestId('claim-scoring');
  await expect(claim).toBeVisible();
  await expect(page.getByTestId('score-entry-form')).toHaveCount(0);

  // One tap takes over — they become the active scorer and the form renders.
  await claim.click();
  await expect(page.getByTestId('score-entry-form')).toBeVisible({ timeout: 15_000 });

  await context.close();
});
