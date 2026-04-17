// Builds a per-player history summary from history-data.ts and overlays
// the 2026 Vegas opening odds. Read-only, no side effects.

import { HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS, HISTORICAL_CASH, normalizePlayerName } from '../apps/api/src/db/history-data.ts';

// 2026 opening-odds board, American odds
const ODDS_BOARD = [
  { name: 'Jaquint', odds: 250, canonical: 'Matt Jaquint' },
  { name: 'Moses', odds: 300, canonical: 'Jason Moses' },
  { name: 'JP', odds: 350, canonical: 'Jay Patterson' },
  { name: 'Biller', odds: 350, canonical: 'Tim Biller' },
  { name: 'Ronnie', odds: 400, canonical: 'Ronnie Adkins' },
  { name: 'Ole Peach', odds: 450, canonical: 'Ben McGinnis' },
  { name: 'Madden', odds: 450, canonical: 'Jeff Madden' },
  { name: 'Stoll', odds: 500, canonical: 'Josh Stoll' },
  { name: 'Bonner', odds: 500, canonical: 'Michael Bonner' },
  { name: 'Bagger', odds: 550, canonical: 'Chris McNeely' },
  { name: 'Scottie P', odds: 550, canonical: 'Scott Pierson' },
  { name: 'Birdie Marshall', odds: 600, canonical: 'Bobby Marshall' },
  { name: 'Kyle', odds: 750, canonical: 'Kyle Cox' },
  { name: 'Wilson', odds: 800, canonical: 'Sean Wilson' },
  { name: 'Matty White', odds: 900, canonical: 'Matt White' },
  { name: 'Biederman', odds: 1000, canonical: 'Jeff Biederman' },
  { name: 'The Factor', odds: 1200, canonical: 'Chris Keaton' },
];

function americanToImpliedPct(odds) {
  // Positive American odds: implied = 100 / (odds + 100)
  return (100 / (odds + 100)) * 100;
}

function fairOddsFromPct(p) {
  // Positive American odds for p in %:
  return Math.round((100 - p) / p * 100);
}

// Normalize every historical name into the canonical DB name
const champs = HISTORICAL_CHAMPIONS.map((c) => ({ year: c.year, name: normalizePlayerName(c.playerName) }));

// Count seasons played (from HISTORICAL_ROSTERS)
const seasonsPlayed = new Map();
for (const [year, roster] of Object.entries(HISTORICAL_ROSTERS)) {
  for (const raw of roster) {
    const n = normalizePlayerName(raw);
    const set = seasonsPlayed.get(n) ?? new Set();
    set.add(Number(year));
    seasonsPlayed.set(n, set);
  }
}

// Rank in each season (from HISTORICAL_STANDINGS — may be partial in early years)
const finishes = new Map(); // name -> [{year, rank, points}]
for (const s of HISTORICAL_STANDINGS) {
  for (const row of s.standings) {
    const n = normalizePlayerName(row.name);
    const arr = finishes.get(n) ?? [];
    arr.push({ year: s.year, rank: row.rank, points: row.points ?? null });
    finishes.set(n, arr);
  }
}

// Top-4 playoff appearances (ranks 1-4 in any season we have full top-4 data for)
const TOP4_YEARS = HISTORICAL_STANDINGS
  .filter((s) => s.standings.some((r) => r.rank === 4))
  .map((s) => s.year);

const top4Appearances = new Map();
for (const s of HISTORICAL_STANDINGS) {
  if (!TOP4_YEARS.includes(s.year)) continue;
  for (const row of s.standings) {
    if (row.rank <= 4) {
      const n = normalizePlayerName(row.name);
      top4Appearances.set(n, (top4Appearances.get(n) ?? 0) + 1);
    }
  }
}

// Championship counts
const titles = new Map();
for (const c of champs) {
  titles.set(c.name, (titles.get(c.name) ?? 0) + 1);
}

// Money Man titles (2023+)
const moneyTitles = new Map();
for (const c of HISTORICAL_CASH) {
  const n = normalizePlayerName(c.moneyMan.name);
  moneyTitles.set(n, (moneyTitles.get(n) ?? 0) + 1);
}

console.log(`\n=== Odds board vs history (top-4 data years: ${TOP4_YEARS.sort().join(', ')}) ===\n`);
console.log(
  ['Name'.padEnd(18), 'Odds', 'Impl%'.padStart(6), 'Titles', 'Top4', 'Seasons', 'Best', 'Avg finish', 'Last 3 finishes', 'Money titles'].join(' | ')
);
console.log('-'.repeat(140));

let totalImplied = 0;
const rows = [];
for (const b of ODDS_BOARD) {
  const impl = americanToImpliedPct(b.odds);
  totalImplied += impl;

  const name = b.canonical;
  const t = titles.get(name) ?? 0;
  const top4 = top4Appearances.get(name) ?? 0;
  const seasons = (seasonsPlayed.get(name) ?? new Set()).size;
  const f = finishes.get(name) ?? [];
  const ranks = f.map((x) => x.rank).filter((r) => r != null);
  const best = ranks.length ? Math.min(...ranks) : null;
  const avgFinish = ranks.length ? (ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1) : '-';
  const last3 = f
    .sort((a, b) => b.year - a.year)
    .slice(0, 3)
    .map((x) => `${String(x.year).slice(2)}:#${x.rank}`)
    .join(', ');
  const moneyT = moneyTitles.get(name) ?? 0;

  rows.push({ ...b, impl, titles: t, top4, seasons, best, avgFinish, last3, moneyT });

  console.log(
    [
      `${b.name} (${name})`.padEnd(18).slice(0, 18),
      `+${b.odds}`.padEnd(5),
      impl.toFixed(1).padStart(5) + '%',
      String(t).padStart(6),
      String(top4).padStart(4),
      String(seasons).padStart(7),
      String(best ?? '-').padStart(4),
      String(avgFinish).padStart(10),
      last3.padEnd(20),
      String(moneyT).padStart(12),
    ].join(' | '),
  );
}

console.log('-'.repeat(140));
console.log(`TOTAL IMPLIED: ${totalImplied.toFixed(1)}% (hold ≈ ${(totalImplied - 100).toFixed(1)}%)`);

// Fair-odds column: take implied %, strip proportional vig, quote back as American odds
console.log(`\n=== Devigged "fair" odds (uniform-vig strip) ===\n`);
for (const r of rows) {
  const fairPct = (r.impl / totalImplied) * 100;
  const fairAmerican = fairOddsFromPct(fairPct);
  const edge = fairPct - r.impl;
  console.log(
    [
      `${r.name} (${r.canonical})`.padEnd(32),
      `book +${r.odds}`,
      `${r.impl.toFixed(1)}%`.padStart(7),
      `fair +${fairAmerican}`,
      `${fairPct.toFixed(1)}%`.padStart(7),
      `(strip ${edge >= 0 ? '+' : ''}${edge.toFixed(1)} pp)`,
    ].join(' | '),
  );
}
