import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });
const all = (s,...p)=>db.prepare(s).all(...p);
const names = Object.fromEntries(all('SELECT id,name FROM players').map(r=>[r.id,r.name]));

const round = all("SELECT id,status,scheduled_date,tee FROM rounds WHERE season_id=14 AND scheduled_date='2026-05-29'");
console.log('ROUND 47:', JSON.stringify(round));

const groups = all("SELECT g.id, g.group_number, g.batting_order FROM groups g JOIN rounds r ON r.id=g.round_id WHERE r.scheduled_date='2026-05-29' AND r.season_id=14 ORDER BY g.group_number");
for (const g of groups) {
  let bo; try{bo=JSON.parse(g.batting_order??'null');}catch{bo=null;}
  const nm = Array.isArray(bo)? bo.map(id=>`${names[id]||id}`):null;
  // scored holes for this group
  const sc = all(`SELECT COUNT(DISTINCT hole_number) AS holes, COUNT(*) AS rows, MAX(hole_number) AS maxhole
                  FROM hole_scores WHERE group_id=?`, g.id)[0];
  console.log(`\n  Group ${g.group_number} (id ${g.id})`);
  console.log(`    batting_order ids : ${JSON.stringify(bo)}`);
  console.log(`    batting_order names: ${nm?nm.join('  ->  '):'(none set)'}`);
  console.log(`    holes scored: ${sc.holes} (rows ${sc.rows}, max hole ${sc.maxhole})`);
}
