import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/app/data/wolf-cup.db', { readOnly: true });
const all = (sql) => db.prepare(sql).all();

console.log('=== seasons ===');
console.log(JSON.stringify(all('SELECT * FROM seasons'), null, 2));

console.log('\n=== season_weeks (all, ordered) ===');
console.log(JSON.stringify(
  all('SELECT id, season_id, friday, is_active, tee FROM season_weeks ORDER BY season_id, friday'),
  null, 2));

console.log('\n=== side_games ===');
console.log(JSON.stringify(
  all('SELECT id, season_id, name, calculation_type, scheduled_fridays, scheduled_round_ids FROM side_games ORDER BY season_id, id'),
  null, 2));

console.log('\n=== rounds (since 2026-05-08) ===');
console.log(JSON.stringify(
  all("SELECT id, season_id, type, status, scheduled_date, tee, cancellation_reason FROM rounds WHERE scheduled_date >= '2026-05-08' ORDER BY scheduled_date"),
  null, 2));
