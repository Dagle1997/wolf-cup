// READ-ONLY dry-run: compute the exact scrub for Most Polies (id 7) ghost 2026-05-22.
// Mirrors the toggle handler's write: scheduledFridays = formula; scheduledRoundIds =
// the round ids for those fridays from NON-CANCELLED OFFICIAL rounds.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });

const SEASON = 14;
const GAME = 7;

const g = db.prepare(
  'SELECT id, name, scheduled_fridays AS sf, scheduled_round_ids AS sr FROM side_games WHERE id = ?'
).get(GAME);
console.log('Current Most Polies row:');
console.log('  scheduled_fridays :', g.sf);
console.log('  scheduled_round_ids:', g.sr);

// formula target = stored minus inactive fridays. Active fridays for season:
const weeks = db.prepare(
  'SELECT friday, is_active AS a FROM season_weeks WHERE season_id = ? ORDER BY friday'
).all(SEASON);
const activeSet = new Set(weeks.filter(w => w.a === 1).map(w => w.friday));
const storedFridays = JSON.parse(g.sf);
const targetFridays = storedFridays.filter(f => activeSet.has(f));
console.log('\nStored fridays      :', JSON.stringify(storedFridays));
console.log('Target fridays      :', JSON.stringify(targetFridays), '(drops inactive)');

// round-id map: non-cancelled OFFICIAL rounds, date -> id
const rounds = db.prepare(
  'SELECT id, scheduled_date AS d, status, type FROM rounds WHERE season_id = ?'
).all(SEASON);
console.log('\nRounds on the affected dates:');
for (const f of storedFridays) {
  const r = rounds.find(x => x.d === f);
  console.log(`  ${f}: ${r ? `round ${r.id} status=${r.status} type=${r.type}` : '(no round)'}`);
}
const dateToRoundId = new Map(
  rounds.filter(r => r.type === 'official' && r.status !== 'cancelled').map(r => [r.d, r.id])
);
const targetRoundIds = targetFridays.map(f => dateToRoundId.get(f)).filter(x => typeof x === 'number');
console.log('\nTarget scheduled_round_ids:', JSON.stringify(targetRoundIds));

// any side_game_results tied to a round NOT in target? (must be none -> safe)
const results = db.prepare('SELECT round_id AS rid FROM side_game_results WHERE side_game_id = ?').all(GAME);
console.log('\nside_game_results round_ids for Most Polies:', JSON.stringify(results.map(r => r.rid)));
const targetRoundIdSet = new Set(targetRoundIds);
const orphaned = results.map(r => r.rid).filter(rid => !targetRoundIdSet.has(rid));
console.log('Result round_ids that would be orphaned by the scrub:', JSON.stringify(orphaned),
  orphaned.length === 0 ? '<-- SAFE' : '<-- *** STOP ***');

console.log('\n=== PROPOSED UPDATE ===');
console.log('  scheduled_fridays  ->', JSON.stringify(targetFridays));
console.log('  scheduled_round_ids ->', JSON.stringify(targetRoundIds));
db.close();
