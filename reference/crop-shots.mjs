/**
 * Crop the brochure phone screenshots: drop the repeated top app-chrome bar
 * (Tournament / Dark / Account) and trailing dead space so the meaningful
 * content fills the brochure frame. Reads *-dark.png, writes *-crop.png in
 * reference/tournament-screenshots/. Re-run after re-capturing.
 *
 *   node reference/crop-shots.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const require = createRequire(resolve(repoRoot, 'apps/tournament-web/package.json'));
const { chromium } = require('@playwright/test');

const DIR = resolve(here, 'tournament-screenshots');

// [src, top, height] — crop window in source px (image is 390 wide).
const CROPS = [
  ['hub-dark.png', 66, 742],        // header + live CTA + all five cards
  ['score-dark.png', 66, 720],      // HOLE header + player cards
  ['leaderboard-dark.png', 66, 628], // tabs + scope + all four rows (incl. Johnny last)
  ['scorecard-dark.png', 66, 600],   // tabs + a player's expanded hole-by-hole
  ['money-dark.png', 66, 560],       // tabs + dollar standings + grid start
];

const browser = await chromium.launch();
for (const [src, top, height] of CROPS) {
  const page = await browser.newPage({ viewport: { width: 390, height } });
  const dataUrl = `data:image/png;base64,${readFileSync(resolve(DIR, src)).toString('base64')}`;
  await page.setContent(
    `<style>*{margin:0;padding:0}body{background:#0a0a0a}</style>` +
    `<img id="x" src="${dataUrl}" style="position:absolute;left:0;top:${-top}px;width:390px;display:block">`,
  );
  await page.waitForFunction(() => {
    const i = document.getElementById('x');
    return Boolean(i && i.complete && i.naturalWidth > 0);
  }, { timeout: 10000 });
  const out = resolve(DIR, src.replace('-dark.png', '-crop.png'));
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 390, height } });
  await page.close();
  // eslint-disable-next-line no-console
  console.log('cropped', out, `390x${height}`);
}
await browser.close();
