/**
 * BROCHURE capture (2026-06-23). Drives the F1-money brochure seed to screenshot
 * the Wolf-style leaderboard (lean rows + expanded per-hole money cards) and the
 * condensed score-entry at a phone viewport. PNGs → e2e/.tmp/brochure-shots/.
 * Run: pnpm --filter @tournament/web exec playwright test --config brochure.config.ts
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { FAKE_STANDALONE_INIT } from './_fixture';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, '.tmp');
const SHOTS = resolve(TMP, 'brochure-shots');
const PHONE = { width: 390, height: 844 };

type BrochureHandoff = {
  eventId: string;
  eventRoundId: string;
  roundId: string;
  viewerSessionId: string;
  scorerSessionId: string;
  playerIds: string[];
  names: string[];
};

test('brochure shots: leaderboard + expanded scorecard + score-entry', async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const fx = JSON.parse(readFileSync(resolve(TMP, 'brochure-handoff.json'), 'utf8')) as BrochureHandoff;

  const ctx = await browser.newContext({ viewport: PHONE });
  await ctx.addCookies([
    { name: 'tournament_session', value: fx.viewerSessionId, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' },
  ]);
  await ctx.addInitScript(FAKE_STANDALONE_INIT);

  // ── 1) Leaderboard, COLLAPSED — the lean Wolf rows (Player·Hcp·thru | To Par | $) ──
  const lb = await ctx.newPage();
  await lb.goto(`/events/${fx.eventId}/leaderboard`, { waitUntil: 'networkidle' }).catch(() => {});
  await lb.waitForTimeout(1000);
  await lb.screenshot({ path: resolve(SHOTS, '1-leaderboard-collapsed.png'), fullPage: true });

  // ── 2) Expand David Miller's card (greenie + low scores) — the p4 hero ──
  const davidId = fx.playerIds[2];
  const davidBtn = lb.locator(`[data-testid="expand-${davidId}"]`);
  if (await davidBtn.count()) {
    await davidBtn.first().click().catch(() => {});
    await lb.waitForTimeout(700);
    await lb.screenshot({ path: resolve(SHOTS, '2-leaderboard-card-david.png'), fullPage: true });
  }

  // ── 3) Expand ALL cards (multi-open showcase) ──
  for (const pid of fx.playerIds) {
    const btn = lb.locator(`[data-testid="expand-${pid}"]`);
    if (await btn.count()) {
      const expanded = await btn.first().getAttribute('aria-expanded');
      if (expanded !== 'true') {
        await btn.first().click().catch(() => {});
        await lb.waitForTimeout(300);
      }
    }
  }
  await lb.waitForTimeout(700);
  await lb.screenshot({ path: resolve(SHOTS, '3-leaderboard-all-expanded.png'), fullPage: true });
  await lb.close();

  // ── 4) Score-entry — the condensed 4-player screen ──
  const se = await ctx.newPage();
  await se.goto(`/rounds/${fx.roundId}/score-entry`, { waitUntil: 'networkidle' }).catch(() => {});
  await se.waitForTimeout(1000);
  await se.screenshot({ path: resolve(SHOTS, '4-score-entry.png'), fullPage: true });
  await se.close();

  await ctx.close();
  expect(true).toBe(true);
});
