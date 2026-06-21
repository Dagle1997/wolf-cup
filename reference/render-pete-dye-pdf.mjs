/**
 * Render the Pete Dye marketing brochure to a phone-sized PDF.
 *
 *   node reference/render-pete-dye-pdf.mjs
 *
 * Resolves Playwright's Chromium from apps/tournament-web (where it's a dep),
 * so it can live here in reference/ without its own node_modules. Re-run this
 * after swapping any screenshots in reference/tournament-screenshots/.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const require = createRequire(resolve(repoRoot, 'apps/tournament-web/package.json'));
const { chromium } = require('@playwright/test');

const HTML = resolve(here, 'pete-dye-marketing.html');
const OUT = resolve(here, 'Pete-Dye-Invitational-The-App.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: OUT, width: '400px', height: '720px', printBackground: true });
await browser.close();
console.log('wrote', OUT);
