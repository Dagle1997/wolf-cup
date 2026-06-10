// WRITE: scrub Most Polies (id 7) ghost. Then re-verify full formula consistency.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db'); // read-write
const SEASON = 14, GAME = 7;
const NEW_FRIDAYS = JSON.stringify(['2026-05-29', '2026-07-17', '2026-08-28']);
const NEW_ROUND_IDS = JSON.stringify([47]);

const before = db.prepare('SELECT scheduled_fridays AS sf, scheduled_round_ids AS sr FROM side_games WHERE id = ?').get(GAME);
console.log('BEFORE:', before.sf, '|', before.sr);

const info = db.prepare(
  'UPDATE side_games SET scheduled_fridays = ?, scheduled_round_ids = ? WHERE id = ? AND season_id = ?'
).run(NEW_FRIDAYS, NEW_ROUND_IDS, GAME, SEASON);
console.log('Rows changed:', info.changes);

const after = db.prepare('SELECT scheduled_fridays AS sf, scheduled_round_ids AS sr FROM side_games WHERE id = ?').get(GAME);
console.log('AFTER :', after.sf, '|', after.sr);

// --- full re-verify: stored scheduled_fridays vs calculateSideGameRotation ---
function calc(games, weeks) {
  const og = [...games].sort((a, b) => a.id - b.id);
  const n = og.length;
  const af = weeks.filter(w => w.isActive === 1).map(w => w.friday).sort();
  return og.map((g, i) => ({ gameId: g.id, fridays: n === 0 ? [] : af.filter((_, j) => j % n === i) }));
}
const weeks = db.prepare('SELECT friday, is_active AS isActive FROM season_weeks WHERE season_id = ? ORDER BY friday').all(SEASON);
const games = db.prepare('SELECT id, name, scheduled_fridays AS sf FROM side_games WHERE season_id = ? ORDER BY id').all(SEASON);
const computed = calc(games.map(g => ({ id: g.id })), weeks);
let ok = true;
console.log('\n--- re-verify ---');
for (const g of games) {
  const stored = [...JSON.parse(g.sf || '[]')].sort();
  const formula = [...((computed.find(c => c.gameId === g.id) || {}).fridays || [])].sort();
  const m = JSON.stringify(stored) === JSON.stringify(formula);
  if (!m) ok = false;
  console.log(`[${g.id}] ${g.name}: ${m ? 'CONSISTENT' : '*** DIVERGENT ***'}`);
}
console.log(`\n==> FORMULA-CONSISTENT OVERALL: ${ok}`);
db.close();
