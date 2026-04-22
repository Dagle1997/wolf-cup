#!/usr/bin/env node
/**
 * Portable wrapper around drizzle-kit that injects tsx as a Node loader
 * via NODE_OPTIONS. Needed because drizzle-kit's internal module loader
 * can't resolve NodeNext-style `.js` re-exports of .ts files — tsx handles
 * the .js → .ts extension rewrite cleanly.
 *
 * Plain `NODE_OPTIONS='--import tsx' drizzle-kit ...` in package.json
 * scripts only works on bash-like shells; on Windows cmd.exe that syntax
 * fails. This wrapper is Node-only and portable.
 *
 * Usage (from package.json scripts):
 *   "db:generate": "node scripts/drizzle-kit.mjs generate"
 *   "db:migrate":  "node scripts/drizzle-kit.mjs migrate"
 *
 * No new dependencies added — tsx is already a devDependency.
 */
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  NODE_OPTIONS: `--import tsx ${process.env.NODE_OPTIONS ?? ''}`.trim(),
};

const result = spawnSync('drizzle-kit', process.argv.slice(2), {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status ?? 1);
