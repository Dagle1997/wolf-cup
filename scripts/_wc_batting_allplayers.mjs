import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });
const all = (sql) => db.prepare(sql).all();

const names = Object.fromEntries(all('SELECT id, name FROM players').map((r) => [r.id, r.name]));
const rows = all(`
  SELECT r.scheduled_date, r.status, g.group_number, g.batting_order
  FROM rounds r JOIN groups g ON g.round_id = r.id
  WHERE r.season_id = 14 AND r.status IN ('finalized','active')
  ORDER BY r.scheduled_date, g.group_number
`);

// player -> array of positions (1-based), only 4-player groups
const tally = new Map();
let roundCount = new Set();
for (const row of rows) {
  let bo; try { bo = JSON.parse(row.batting_order ?? 'null'); } catch { continue; }
  if (!Array.isArray(bo) || bo.length !== 4) continue;
  roundCount.add(row.scheduled_date);
  bo.forEach((pid, i) => {
    const k = Number(pid);
    if (!tally.has(k)) tally.set(k, []);
    tally.get(k).push(i + 1);
  });
}

console.log(`Rounds with recorded 4-player draws: ${[...roundCount].join(', ')}\n`);
console.log('player                  n   pos counts [1,2,3,4]   pattern');
const out = [...tally.entries()].map(([pid, positions]) => {
  const counts = [0, 0, 0, 0];
  positions.forEach((p) => counts[p - 1]++);
  const n = positions.length;
  const maxc = Math.max(...counts);
  const skew = n >= 3 && maxc === n ? 'ALL SAME ***' : (n >= 4 && maxc >= n - 0 ? '' : '');
  const allSame = n >= 3 && maxc === n;
  const mostly = n >= 4 && maxc >= 3 && !allSame;
  return { pid, n, counts, maxc, allSame, mostly };
}).sort((a, b) => (b.maxc / b.n) - (a.maxc / a.n) || b.n - a.n);

for (const r of out) {
  const flag = r.allSame ? `ALL pos${r.counts.indexOf(r.maxc)+1} ***` : r.mostly ? `mostly pos${r.counts.indexOf(r.maxc)+1}` : '';
  console.log(`${(names[r.pid]||('id'+r.pid)).padEnd(22)} ${String(r.n).padStart(2)}   [${r.counts.join(',')}]            ${flag}`);
}
