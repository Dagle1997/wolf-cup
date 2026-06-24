/**
 * Render the "How to use the app" instructions to a phone-sized PDF.
 *
 *   node reference/render-instructions-pdf.mjs
 *
 * Mirrors render-pete-dye-pdf.mjs: resolves Playwright's Chromium from
 * apps/tournament-web and renders the brochure-styled instructions HTML.
 * Re-run after refreshing the screenshots in reference/instructions-screenshots/
 * (capture them with `pnpm --filter @tournament/web exec playwright test
 * screenshots.spec.ts`, which writes to apps/tournament-web/e2e/.tmp/shots/).
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const require = createRequire(resolve(repoRoot, 'apps/tournament-web/package.json'));
const { chromium } = require('@playwright/test');

const HTML = resolve(here, 'tournament-instructions.html');
const OUT = resolve(here, 'Pete-Dye-Invitational-How-To.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: OUT, width: '400px', height: '720px', printBackground: true });
await browser.close();
console.log('wrote', OUT);
