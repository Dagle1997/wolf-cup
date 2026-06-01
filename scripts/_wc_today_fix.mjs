import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db');

const NET_PARS = 2;   // Most Net Pars  (auto_net_pars)
const POLIES = 7;     // Most Polies    (auto_polies)
const ROUND = 47;     // today, 2026-05-29

const get = (id) => JSON.parse(db.prepare('SELECT scheduled_round_ids FROM side_games WHERE id = ?').get(id).scheduled_round_ids ?? '[]');

console.log('BEFORE  NetPars(2):', JSON.stringify(get(NET_PARS)));
console.log('BEFORE  Polies(7) :', JSON.stringify(get(POLIES)));

db.exec('BEGIN');
try {
  const np = get(NET_PARS).filter((x) => x !== ROUND);
  const po = get(POLIES);
  if (!po.includes(ROUND)) po.push(ROUND);
  db.prepare('UPDATE side_games SET scheduled_round_ids = ? WHERE id = ?').run(JSON.stringify(np), NET_PARS);
  db.prepare('UPDATE side_games SET scheduled_round_ids = ? WHERE id = ?').run(JSON.stringify(po), POLIES);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

console.log('AFTER   NetPars(2):', JSON.stringify(get(NET_PARS)));
console.log('AFTER   Polies(7) :', JSON.stringify(get(POLIES)));
