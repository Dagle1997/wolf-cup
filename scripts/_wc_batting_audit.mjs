import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);

// Find Josh
const josh = all("SELECT id, name FROM players WHERE name LIKE '%Stoll%' OR name LIKE 'Josh%'");
console.log('Josh candidates:', JSON.stringify(josh));
const joshIds = josh.map((r) => r.id);

// All season-14 rounds with groups + batting order
const rows = all(`
  SELECT r.id AS round_id, r.scheduled_date, r.status, g.id AS group_id, g.group_number, g.batting_order
  FROM rounds r JOIN groups g ON g.round_id = r.id
  WHERE r.season_id = 14
  ORDER BY r.scheduled_date, g.group_number
`);

console.log('\nround_date  status      grp  battingOrder            josh_pos/len');
for (const row of rows) {
  let bo;
  try { bo = JSON.parse(row.batting_order ?? 'null'); } catch { bo = null; }
  if (!Array.isArray(bo)) continue;
  const idx = bo.findIndex((pid) => joshIds.includes(Number(pid)));
  const mark = idx >= 0 ? `*** pos ${idx + 1} of ${bo.length} ***` : '';
  console.log(`${row.scheduled_date}  ${String(row.status).padEnd(10)}  g${row.group_number}  ${JSON.stringify(bo).padEnd(22)}  ${mark}`);
}
