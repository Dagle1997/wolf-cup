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
        patterns: [
          {
            group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'],
            message: 'Tournament may only import @wolf-cup/engine/stableford (FD-11/12).',
          },
          // T8-1: block direct imports of the `activity` schema export
          // outside the emitter. Defense-in-depth against the rename-
          // bypass of the `no-restricted-syntax` rule below: if a file
          // can't import `activity`, it can't write to it under any
          // call shape. Allowlisted files override below.
          {
            group: ['*db/schema*'],
            importNames: ['activity'],
            message: 'Direct `activity` schema imports are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
          },
          // Also block direct path imports of the activity schema file
          // (so `import { activity } from '../db/schema/activity.js'`
          // outside the emitter is also rejected). Glob covers no-ext,
          // .js, .ts, .mjs to defend against any module-resolution
          // variant that might land in a future TS config change.
          {
            group: ['**/db/schema/activity', '**/db/schema/activity.*'],
            message: 'Direct path imports of the activity schema are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
          },
        ],
      }],
      // T8-1: block direct writes to the activity table by AST shape.
      // Multiple selectors catch the realistic call shapes:
      //   1. tx.insert(activity)          — member-call + Identifier arg
      //   2. tx.insert(schema.activity)   — member-call + namespace-imported MemberExpression arg
      //   3. insert(activity)             — destructured-call + Identifier arg
      //   4. insert(schema.activity)      — destructured-call + namespace-imported MemberExpression arg
      //   5. tx['insert'](activity)       — computed-property bracket access (matches selector #1's parent CallExpression but not callee.property.name; covered by selector below)
      // Together with the no-restricted-imports block above, this gates
      // the table behind emitActivity.
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(insert|update|delete)$/] > Identifier[name='activity']",
          message: 'Direct writes to the activity table are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(insert|update|delete)$/] > MemberExpression[property.name='activity'][computed=false]",
          message: 'Direct writes to the activity table via namespace import are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
        },
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name=/^(insert|update|delete)$/] > Identifier[name='activity']",
          message: 'Direct destructured writes to the activity table are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
        },
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name=/^(insert|update|delete)$/] > MemberExpression[property.name='activity'][computed=false]",
          message: 'Direct destructured writes to the activity table via namespace import are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value=/^(insert|update|delete)$/] > Identifier[name='activity']",
          message: 'Direct writes to the activity table via computed-property access are forbidden. Use emitActivity() from src/lib/activity.ts (T8-1).',
        },
      ],
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
    // T8-2 codex impl-codex round-1 Critical #1 + round-2 Med #1: the
    // read-side service needs the `activity` schema import permitted
    // BUT must keep the engine-import restriction armed AND keep the
    // write-gate armed. Re-declare `no-restricted-imports` here with
    // ONLY the engine block (omitting the activity-import block); do
    // NOT touch `no-restricted-syntax` so the write-gate selectors
    // continue to fire if anyone adds tx.insert(activity) to this
    // file by mistake.
    files: [
      'src/services/activity-feed.ts',
      // T8-4: awards service is the read-side companion to the
      // emitter. SELECTs against activity for idempotency; never
      // writes (emitActivity is the only legitimate writer).
      'src/services/awards.ts',
    ],
    rules: {
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
    },
  },
  {
    // T8-1 + T8-2: emitter + tests that legitimately do tx.insert/update/delete
    // on the activity table. Both the import block AND the write-gate
    // are off for these paths. The fixture file at
    // __fixtures__/activity-direct-write-violation.ts is INTENTIONALLY
    // NOT in this allowlist — it must lint-fail to prove the gate works
    // end-to-end (asserted by activity.eslint-rule.test.ts).
    files: [
      'src/lib/activity.ts',
      'src/lib/activity.test.ts',
      'src/lib/activity.eslint-rule.test.ts',
      // T8-2: integration test seeds raw activity rows to set up the
      // 250-row burst-drop fixtures + corrupt-row scenarios. Tests are
      // the natural place for direct schema access; the gate's purpose
      // is preventing production-code drift, not test-fixture setup.
      'src/routes/activity.integration.test.ts',
      // T8-4: awards service test seeds raw activity rows to set up
      // the idempotency + first-eagle-after-birdie scenarios.
      'src/services/awards.test.ts',
      // Story 1.1 betting: clears the activity table between cases (the
      // create path emits action_bet.created via emitActivity in prod code).
      'src/routes/admin-event-bets.integration.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
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
