import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db');

// --- Target state (explicit, verified against the shift table) -------------
// season_weeks.tee for future active weeks (id -> tee). 6/05 (id 29) untouched.
const TEE = {
  28: 'white', // 05/29
  30: 'blue',  // 06/12
  31: 'black', // 06/19
  32: 'white', // 06/26
  33: 'blue',  // 07/03
  34: 'black', // 07/10
  35: 'white', // 07/17
  36: 'blue',  // 07/24
  37: 'black', // 07/31
  38: 'white', // 08/07
  39: 'blue',  // 08/14
  40: 'black', // 08/21
  41: 'white', // 08/28
  42: 'blue',  // 09/04
};

// side_games.scheduled_fridays (id -> full friday list; past played weeks kept)
const FRIDAYS = {
  2: ['2026-04-17', '2026-06-12', '2026-07-24', '2026-09-04'], // Net Pars
  3: ['2026-04-24', '2026-06-19', '2026-07-31'],               // CTP (3x - tail absorbed)
  4: ['2026-05-01', '2026-06-26', '2026-08-07'],               // Skins
  5: ['2026-05-08', '2026-07-03', '2026-08-14'],               // Least Putts
  6: ['2026-05-15', '2026-07-10', '2026-08-21'],               // Net Under Par
  7: ['2026-05-22', '2026-05-29', '2026-07-17', '2026-08-28'], // Most Polies
};

const fridayById = Object.fromEntries(
  db.prepare("SELECT id, friday FROM season_weeks WHERE season_id = 14").all().map((r) => [r.id, r.friday]));

db.exec('BEGIN');
try {
  for (const [id, tee] of Object.entries(TEE)) {
    db.prepare('UPDATE season_weeks SET tee = ? WHERE id = ?').run(tee, Number(id));
  }
  for (const [id, fr] of Object.entries(FRIDAYS)) {
    db.prepare('UPDATE side_games SET scheduled_fridays = ? WHERE id = ?').run(JSON.stringify(fr), Number(id));
  }

  // --- Sanity assertions before commit -----------------------------------
  // 1. Every active week's friday maps to exactly one game.
  const activeWeeks = db.prepare("SELECT friday, tee, is_active FROM season_weeks WHERE season_id = 14 AND is_active = 1 ORDER BY friday").all();
  const games = db.prepare("SELECT id, name, scheduled_fridays FROM side_games WHERE season_id = 14").all();
  const fridayToGames = {};
  for (const g of games) {
    for (const f of JSON.parse(g.scheduled_fridays)) {
      (fridayToGames[f] ??= []).push(g.name);
    }
  }
  for (const w of activeWeeks) {
    const gs = fridayToGames[w.friday] ?? [];
    if (gs.length !== 1) throw new Error(`Friday ${w.friday} maps to ${gs.length} games: ${gs.join(',')}`);
    if (!w.tee) throw new Error(`Friday ${w.friday} has no tee`);
  }
  // 2. No game friday points at the inactive 6/05 week.
  if (fridayToGames['2026-06-05']) throw new Error('6/05 (off-week) got a game assigned');

  db.exec('COMMIT');

  // --- Print reconstructed schedule --------------------------------------
  console.log('FINAL SCHEDULE (active weeks):');
  for (const w of activeWeeks) {
    console.log(`  ${w.friday}  ${String(w.tee).padEnd(6)}  ${(fridayToGames[w.friday] || ['?'])[0]}`);
  }
  console.log('\n(6/05 remains off-week: is_active=0)');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}
