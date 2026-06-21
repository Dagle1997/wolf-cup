/**
 * Swap freshly-captured e2e screenshots into the brochure's image folder and
 * re-render the PDF. Run after `playwright test screenshots.spec.ts` (see
 * SCREENSHOTS.md). Idempotent; skips any source shot that isn't present.
 *
 *   node reference/swap-and-render.mjs
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const SHOTS = resolve(repoRoot, 'apps/tournament-web/e2e/.tmp/shots');
const DEST = resolve(here, 'tournament-screenshots');

// brochure slot  <-  e2e capture filename
const MAP = {
  'hub.png': '15-event-home-live.png',
  'leaderboard.png': '09-leaderboard.png',
  'foursome-results.png': '14-foursome-results.png',
  'money.png': '11-money.png',
};

let swapped = 0;
for (const [slot, src] of Object.entries(MAP)) {
  const from = resolve(SHOTS, src);
  if (!existsSync(from)) {
    console.warn(`! missing capture, kept existing: ${src}`);
    continue;
  }
  copyFileSync(from, resolve(DEST, slot));
  console.log(`swapped ${slot} <- ${src}`);
  swapped++;
}

if (swapped === 0) {
  console.error('No captures found in', SHOTS, '— run the playwright capture first (see SCREENSHOTS.md).');
  process.exit(1);
}

console.log(`\nre-rendering PDF (${swapped} shot${swapped === 1 ? '' : 's'} updated)…`);
execFileSync('node', [resolve(here, 'render-pete-dye-pdf.mjs')], { stdio: 'inherit' });
