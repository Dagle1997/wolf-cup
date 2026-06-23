/**
 * Generate the PWA home-screen icons (replaces the blank placeholder tiles).
 * Renders a maskable-safe dark-green tile with a "PD" monogram + a small golf
 * flag, then screenshots it at 512 and 192. Re-run after tweaking the markup.
 *
 *   node apps/tournament-web/scripts/gen-pwa-icon.mjs
 *
 * Resolves Playwright's Chromium from this package (where it's a dev dep).
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const require = createRequire(resolve(webRoot, 'package.json'));
const { chromium } = require('@playwright/test');

const PUBLIC = resolve(webRoot, 'public');

// Full-bleed tile (maskable: keep content inside the centre ~72%). Brand greens
// from the marketing palette; gold underline accent; bold "PD" + a golf flag.
const html = (px) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${px}px; height: ${px}px; }
  .tile {
    width: ${px}px; height: ${px}px;
    background: linear-gradient(150deg, #16a34a 0%, #0f5c2e 55%, #0a0f0a 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: 'Inter', sans-serif;
  }
  .flag { font-size: ${px * 0.20}px; line-height: 1; margin-bottom: ${px * 0.02}px; }
  .mono {
    font-weight: 900; color: #ffffff; font-size: ${px * 0.42}px;
    letter-spacing: ${px * -0.01}px; line-height: 1;
    text-shadow: 0 ${px * 0.01}px ${px * 0.03}px rgba(0,0,0,0.35);
  }
  .bar { width: ${px * 0.26}px; height: ${px * 0.035}px; background: #f59e0b; border-radius: 999px; margin-top: ${px * 0.05}px; }
</style></head>
<body><div class="tile"><div class="flag">⛳</div><div class="mono">PD</div><div class="bar"></div></div></body></html>`;

const browser = await chromium.launch();
for (const px of [512, 192]) {
  const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await page.setContent(html(px), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const out = resolve(PUBLIC, `icon-${px}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: px, height: px } });
  await page.close();
  // eslint-disable-next-line no-console
  console.log('wrote', out, `${px}x${px}`);
}
await browser.close();
