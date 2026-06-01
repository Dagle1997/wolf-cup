import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });
const all=(s,...p)=>db.prepare(s).all(...p);
const names=Object.fromEntries(all('SELECT id,name FROM players').map(r=>[r.id,r.name]));
const N=id=>names[id]||('id'+id);

// WOLF_TABLE slot->holes (engine/wolf.ts)
const SLOT_OF_HOLE={2:0,6:0,9:0,14:0, 4:1,7:1,10:1,16:1, 5:2,11:2,12:2,17:2, 8:3,13:3,15:3,18:3};

const g=all("SELECT id,batting_order FROM groups WHERE id=103")[0];
const order=JSON.parse(g.batting_order);
console.log('Group 1 batting_order:', JSON.stringify(order), '=', order.map(N).join(' -> '));
console.log('(corrected target was [11,13,21,17] = Matt,Scott,Kyle,Ronnie)\n');

const wd=all("SELECT hole_number,decision,partner_player_id,outcome FROM wolf_decisions WHERE group_id=103 ORDER BY hole_number");
console.log('hole | expected wolf (corrected order) | decision | partner | outcome | CHECK');
let problems=0;
for(const d of wd){
  const slot=SLOT_OF_HOLE[d.hole_number];
  const wolf=order[slot];
  const partnerOk = d.partner_player_id==null || (order.includes(d.partner_player_id) && d.partner_player_id!==wolf);
  const flag = partnerOk ? 'ok' : '*** BAD partner ***';
  if(!partnerOk) problems++;
  console.log(`  ${String(d.hole_number).padStart(2)} | ${N(wolf).padEnd(14)} | ${String(d.decision).padEnd(8)} | ${(d.partner_player_id?N(d.partner_player_id):'-').padEnd(14)} | ${String(d.outcome).padEnd(5)} | ${flag}`);
}

const rr=all("SELECT player_id,money_total,stableford_total FROM round_results WHERE round_id=47");
const g103ids=new Set(order);
let sum=0;
console.log('\nGroup 1 money:');
for(const r of rr){ if(g103ids.has(r.player_id)){ console.log(`  ${N(r.player_id).padEnd(14)} $${r.money_total}  (stbl ${r.stableford_total})`); sum+=Number(r.money_total);} }
console.log('  SUM = $'+sum+(sum===0?'  (zero-sum OK)':'  *** NOT ZERO ***'));

console.log('\nHI snapshot (round_players.handicap_index) for Group 1:');
for(const id of order){
  const rp=all("SELECT handicap_index FROM round_players WHERE round_id=47 AND player_id=?",id)[0];
  console.log(`  ${N(id).padEnd(14)} HI=${rp?rp.handicap_index:'(none)'}`);
}
console.log('\nProblems flagged:', problems);
