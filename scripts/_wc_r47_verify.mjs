import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });
const all = (s,...p)=>db.prepare(s).all(...p);
const get = (s,...p)=>db.prepare(s).get(...p);
const names = Object.fromEntries(all('SELECT id,name FROM players').map(r=>[r.id,r.name]));

const r = get("SELECT id,status,tee,scheduled_date FROM rounds WHERE season_id=14 AND scheduled_date='2026-05-29'");
console.log('ROUND 47:', JSON.stringify(r));

// group-by-group money zero-sum
const groups = all("SELECT id, group_number, batting_order FROM groups WHERE round_id=47 ORDER BY group_number");
const rr = all("SELECT player_id, money_total, stableford_total FROM round_results WHERE round_id=47");
const moneyOf = Object.fromEntries(rr.map(x=>[x.player_id, x.money_total]));
let total=0;
for (const g of groups){
  const ids = JSON.parse(g.batting_order??'[]');
  const sum = ids.reduce((a,id)=>a+Number(moneyOf[id]??0),0);
  total += sum;
  console.log(`  G${g.group_number} order=[${ids.map(i=>names[i]).join(', ')}]  money_sum=${sum}`);
}
console.log('  ROUND money sum =', total, '(should be 0)');

console.log('\nharvey_results rows:', get('SELECT COUNT(*) c FROM harvey_results WHERE round_id=47').c);
const sg = all("SELECT sg.name, sgr.winner_player_id, sgr.winner_name, sgr.notes FROM side_game_results sgr JOIN side_games sg ON sg.id=sgr.side_game_id WHERE sgr.round_id=47");
console.log('side_game_results for r47:', sg.length ? JSON.stringify(sg.map(x=>({game:x.name, winner: names[x.winner_player_id]||x.winner_name, notes:x.notes}))) : '(none yet)');
