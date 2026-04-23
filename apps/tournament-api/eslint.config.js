// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@wolf-cup/engine',
          message: 'Tournament may only import from @wolf-cup/engine/stableford (FD-11/12). Use the subpath import.',
        }],
        patterns: [{
          group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'],
          message: 'Tournament may only import @wolf-cup/engine/stableford (FD-11/12).',
        }],
      }],
      // T1-7: prevent regression back to console.* for structured logging.
      // Production callsites use `c.get('logger')` (request-scoped) or the
      // module-level singleton from `src/lib/log.ts`. File overrides below
      // exempt specific entrypoints where the logger isn't yet available.
      // `'error'` with no options disallows every console method; passing
      // `{ allow: [] }` would fail ESLint's JSON-schema check (allow must
      // be non-empty when present).
      'no-console': 'error',
    },
  },
  {
    // Exemptions for files where the structured logger isn't a fit:
    // - src/port.ts: runs at env-parse time BEFORE env.ts loads, so the
    //   pino singleton isn't yet constructible. Its console.warn stays.
    // - src/db/migrate.ts + src/db/seed.ts: short-lived CLI entrypoints
    //   invoked via `node dist/db/*.js` with no request context and no
    //   need for pino transport overhead.
    files: ['src/port.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
    rules: { 'no-console': 'off' },
  },
);
