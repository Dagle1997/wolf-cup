// Read-only DB introspection for season-winner odds analysis.
// Prints table list, per-player historical summary, and scoring-variance
// signals that matter for best-10-of-20 + playoff formats.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../apps/api/data/wolf-cup.db');

const db = new Database(DB_PATH, { readonly: true });

function q(sql, params = []) {
  return db.prepare(sql).all(...params);
}

const args = process.argv.slice(2);
const mode = args[0] ?? 'summary';

if (mode === 'tables') {
  for (const r of q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")) {
    const count = q(`SELECT COUNT(*) AS c FROM ${r.name}`)[0].c;
    console.log(`${r.name.padEnd(32)} ${count}`);
  }
  process.exit(0);
}

if (mode === 'schema') {
  const table = args[1];
  if (!table) { console.error('usage: schema <table>'); process.exit(1); }
  for (const r of q(`PRAGMA table_info(${table})`)) {
    console.log(`${r.name.padEnd(24)} ${r.type.padEnd(10)} ${r.notnull ? 'NOT NULL' : ''} ${r.dflt_value ?? ''}`);
  }
  process.exit(0);
}

if (mode === 'seasons') {
  for (const r of q('SELECT id, name, year, start_date, end_date, total_rounds FROM seasons ORDER BY year')) {
    console.log(r);
  }
  process.exit(0);
}

if (mode === 'standings') {
  const rows = q(`
    SELECT s.year, p.name, st.rank, st.total_points, st.rounds_played, st.harvey_points, st.wolf_money_total
    FROM standings st
    JOIN seasons s ON s.id = st.season_id
    JOIN players p ON p.id = st.player_id
    ORDER BY s.year DESC, st.rank ASC
  `);
  for (const r of rows) console.log(r);
  process.exit(0);
}

if (mode === 'roster') {
  for (const r of q('SELECT id, name, status, is_active FROM players ORDER BY name')) {
    console.log(r);
  }
  process.exit(0);
}

if (mode === 'player-history') {
  const needle = args[1];
  if (!needle) { console.error('usage: player-history <name substring>'); process.exit(1); }
  const players = q("SELECT id, name FROM players WHERE name LIKE ? ORDER BY name", [`%${needle}%`]);
  for (const p of players) {
    console.log(`\n=== ${p.name} (id ${p.id}) ===`);
    const hist = q(`
      SELECT s.year, st.rank, st.total_points, st.rounds_played, st.harvey_points, st.wolf_money_total
      FROM standings st
      JOIN seasons s ON s.id = st.season_id
      WHERE st.player_id = ?
      ORDER BY s.year ASC
    `, [p.id]);
    for (const h of hist) console.log(h);
  }
  process.exit(0);
}

console.error(`unknown mode: ${mode}`);
console.error('modes: tables | schema <t> | seasons | standings | roster | player-history <name>');
process.exit(1);
