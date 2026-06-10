// READ-ONLY prod check: are live side_games formula-consistent, and would
// unchecking the next active Friday (rainout) shift cleanly or skip-with-warning?
// Mirrors apps/api/src/utils/side-game-rotation.ts exactly.
import { DatabaseSync } from 'node:sqlite';

const TODAY = '2026-06-10';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });

function calculateSideGameRotation(games, weeks) {
  const orderedGames = [...games].sort((a, b) => a.id - b.id);
  const n = orderedGames.length;
  const activeFridays = weeks
    .filter((w) => w.isActive === 1)
    .map((w) => w.friday)
    .sort();
  return orderedGames.map((game, gameIdx) => ({
    gameId: game.id,
    fridays: n === 0 ? [] : activeFridays.filter((_, i) => i % n === gameIdx),
  }));
}

const season = db.prepare('SELECT id, year FROM seasons ORDER BY year DESC LIMIT 1').get();
console.log('Current season:', season);

const weeks = db.prepare(
  'SELECT friday, is_active AS isActive, tee FROM season_weeks WHERE season_id = ? ORDER BY friday'
).all(season.id);

const games = db.prepare(
  'SELECT id, name, scheduled_fridays AS sf, scheduled_round_ids AS sr FROM side_games WHERE season_id = ? ORDER BY id'
).all(season.id);

const rounds = db.prepare(
  "SELECT id, scheduled_date AS d, status FROM rounds WHERE season_id = ? ORDER BY scheduled_date"
).all(season.id);

console.log('\n--- season_weeks (active marked *) ---');
for (const w of weeks) console.log(`${w.isActive ? '*' : ' '} ${w.friday}  tee=${w.tee ?? 'null'}`);

console.log('\n--- side_games stored vs FORMULA ---');
const computed = calculateSideGameRotation(games.map(g => ({ id: g.id })), weeks);
let allConsistent = true;
for (const g of games) {
  let stored;
  try { stored = JSON.parse(g.sf || '[]'); } catch { stored = '<<malformed JSON>>'; }
  const formula = (computed.find(c => c.gameId === g.id) || {}).fridays || [];
  const sortedStored = Array.isArray(stored) ? [...stored].sort() : stored;
  const sortedFormula = [...formula].sort();
  const match = JSON.stringify(sortedStored) === JSON.stringify(sortedFormula);
  if (!match) allConsistent = false;
  console.log(`\n[${g.id}] ${g.name}  ${match ? 'CONSISTENT' : '*** DIVERGENT ***'}`);
  console.log(`    stored : ${JSON.stringify(sortedStored)}`);
  console.log(`    formula: ${JSON.stringify(sortedFormula)}`);
}
console.log(`\n==> FORMULA-CONSISTENT OVERALL: ${allConsistent}`);

// Next upcoming active Friday (the one that would be unchecked on a rainout)
const settledStatuses = new Set(['active', 'finalized', 'completed']);
const roundByDate = new Map(rounds.map(r => [r.d, r]));
const upcoming = weeks
  .filter(w => w.isActive === 1 && w.friday >= TODAY)
  .map(w => w.friday)
  .sort();
const nextFri = upcoming[0];
console.log(`\n--- Rainout simulation: uncheck next active Friday = ${nextFri} ---`);

if (!nextFri) {
  console.log('No upcoming active Friday found.');
} else {
  // ownership per Friday BEFORE
  const ownerBefore = new Map();
  for (const c of computed) for (const f of c.fridays) ownerBefore.set(f, c.gameId);
  // simulate toggle off
  const simWeeks = weeks.map(w => w.friday === nextFri ? { ...w, isActive: 0 } : w);
  const after = calculateSideGameRotation(games.map(g => ({ id: g.id })), simWeeks);
  const ownerAfter = new Map();
  for (const c of after) for (const f of c.fridays) ownerAfter.set(f, c.gameId);

  // settled-history guard: any settled round whose Friday changes game ownership?
  const violations = [];
  for (const r of rounds) {
    if (!settledStatuses.has(r.status)) continue;
    const b = ownerBefore.get(r.d);
    const a = ownerAfter.get(r.d);
    if (b !== a) violations.push({ round: r.id, date: r.d, status: r.status, before: b, after: a });
  }
  const gname = id => (games.find(g => g.id === id) || {}).name ?? id;
  console.log(`\nNext Friday ${nextFri} currently hosts: [${ownerBefore.get(nextFri)}] ${gname(ownerBefore.get(nextFri))}`);
  console.log('\nGame ownership AFTER unchecking (active future Fridays):');
  for (const c of after) {
    const fut = c.fridays.filter(f => f >= TODAY);
    if (fut.length) console.log(`  [${c.gameId}] ${gname(c.gameId)}: ${JSON.stringify(fut)}`);
  }
  console.log(`\nSettled rounds (status active/finalized): ${rounds.filter(r => settledStatuses.has(r.status)).length}`);
  if (violations.length === 0) {
    console.log('GUARD: no settled round changes game ownership ==> recompute APPLIES CLEANLY.');
  } else {
    console.log('GUARD: WOULD SKIP-WITH-WARNING. Settled rounds affected:');
    for (const v of violations) console.log('  ', v);
  }
}
db.close();
