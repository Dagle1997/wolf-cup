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
  organizerSessionId: string;
  scorerSessionId: string;
  playerIds: string[];
  names: string[];
};

// Force DARK mode before first paint: the app's no-flash init reads
// localStorage('tournament-theme'); 'dark' → the `.dark` class. (colorScheme on
// the context also covers the 'system' default.)
const FORCE_DARK = `try { localStorage.setItem('tournament-theme', 'dark'); } catch (e) {}`;

async function darkContext(browser: import('@playwright/test').Browser, sessionId: string) {
  const ctx = await browser.newContext({ viewport: PHONE, colorScheme: 'dark' });
  await ctx.addCookies([
    { name: 'tournament_session', value: sessionId, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' },
  ]);
  await ctx.addInitScript(FORCE_DARK);
  await ctx.addInitScript(FAKE_STANDALONE_INIT);
  return ctx;
}

test('brochure shots: leaderboard + expanded scorecard + score-entry', async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const fx = JSON.parse(readFileSync(resolve(TMP, 'brochure-handoff.json'), 'utf8')) as BrochureHandoff;

  // Leaderboard viewed as the ORGANIZER (a non-player) so no row reads "(you)".
  const ctx = await darkContext(browser, fx.organizerSessionId);

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
  await ctx.close();

  // ── 4) Score-entry — viewed as the SCORER (the organizer can't score) ──
  const scorerCtx = await darkContext(browser, fx.scorerSessionId);
  const se = await scorerCtx.newPage();
  await se.goto(`/rounds/${fx.roundId}/score-entry`, { waitUntil: 'networkidle' }).catch(() => {});
  await se.waitForTimeout(1000);
  // The auto-advance lands on the first unscored hole (10), so the wells are
  // empty. Step BACK with Prev onto the par-3 7th (10→7): a fully-scored hole
  // that shows the colored gross numbers AND, because it's a par 3, the greenie
  // (G) toggle — with an active greenie (Johnny) and polie (David) from the seed.
  const prev = se.locator('[data-testid="prev-hole"]');
  if (await prev.count()) {
    for (let i = 0; i < 3; i++) {
      await prev.first().click().catch(() => {});
      await se.waitForTimeout(350);
    }
    await se.waitForTimeout(400);
  }
  // Strip the dev-only vite-plugin-pwa registration badge (the app icon shown
  // bottom-right in dev) — it never appears in the installed/prod app. Walk the
  // whole tree incl. shadow roots; hide any fixed/absolute element that is (or
  // contains) an <img> whose src looks like the app icon.
  // The Save bar is position:sticky; in a fullPage capture Playwright freezes it
  // mid-page (a sticky-capture artifact), making it look like it overlaps the
  // last card. Pin it to static for the shot so it flows to its natural spot
  // below the cards (on a real phone the 112px trailing pad gives the clearance).
  await se.evaluate(() => {
    const bar = document.querySelector('[data-testid="save-bar"]') as HTMLElement | null;
    if (bar) bar.style.position = 'static';
  });
  await se.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const visit = (root: Document | ShadowRoot) => {
      root.querySelectorAll('*').forEach((el) => {
        const e = el as HTMLElement;
        if (e.shadowRoot) visit(e.shadowRoot);
        const pos = getComputedStyle(e).position;
        if (pos !== 'fixed' && pos !== 'absolute') return; // leaves the sticky save bar alone
        const r = e.getBoundingClientRect();
        // small badge anchored to the bottom-right corner
        if (r.width > 0 && r.width < 140 && r.height < 140 && r.right > vw - 120 && r.bottom > vh - 160) {
          e.style.display = 'none';
        }
      });
    };
    visit(document);
  });
  await se.waitForTimeout(200);
  await se.screenshot({ path: resolve(SHOTS, '4-score-entry.png'), fullPage: true });
  await se.close();
  await scorerCtx.close();

  expect(true).toBe(true);
});
