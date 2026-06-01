import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db');
const all = (s,...p)=>db.prepare(s).all(...p);
const get = (s,...p)=>db.prepare(s).get(...p);

const GROUP = 103;
const CURRENT = [11,13,17,21];   // Matt, Scott, Ronnie, Kyle  (WRONG: 3&4 swapped)
const CORRECT = [11,13,21,17];   // Matt, Scott, Kyle, Ronnie  (as drawn)

const g = get('SELECT id, group_number, batting_order FROM groups WHERE id=?', GROUP);
console.log('current batting_order:', g.batting_order);

const cur = JSON.parse(g.batting_order);
const sc = get('SELECT COUNT(DISTINCT hole_number) holes, MAX(hole_number) maxhole FROM hole_scores WHERE group_id=?', GROUP);
console.log('scored: holes', sc.holes, 'max', sc.maxhole);

// wolf_decisions for this group, by hole
const wd = all('SELECT hole_number FROM wolf_decisions WHERE group_id=? ORDER BY hole_number', GROUP);
console.log('wolf_decision holes:', JSON.stringify(wd.map(r=>r.hole_number)));

// GUARDS — slot-3 wolf first appears at hole 5; slot-4 at hole 8. Safe iff nothing
// scored or decided at hole >= 5.
const errs = [];
if (JSON.stringify(cur) !== JSON.stringify(CURRENT)) errs.push(`order is ${g.batting_order}, expected ${JSON.stringify(CURRENT)}`);
if ((sc.maxhole ?? 0) >= 5) errs.push(`scored hole ${sc.maxhole} >= 5 — swap would affect a played wolf hole`);
if (wd.some(r => r.hole_number >= 5)) errs.push(`wolf decision exists at hole >= 5`);

if (errs.length) {
  console.log('\nABORT — guards failed:\n  ' + errs.join('\n  '));
  process.exit(1);
}

db.exec('BEGIN');
try {
  db.prepare('UPDATE groups SET batting_order=? WHERE id=?').run(JSON.stringify(CORRECT), GROUP);
  db.exec('COMMIT');
} catch(e) { db.exec('ROLLBACK'); throw e; }

console.log('\nNEW batting_order:', get('SELECT batting_order FROM groups WHERE id=?', GROUP).batting_order);
console.log('=> Matt(11) -> Scott(13) -> Kyle(21) -> Ronnie(17)');
