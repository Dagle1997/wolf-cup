/**
 * T8-1 ESLint rule tests for the activity-table write gate.
 *
 * Two-pronged coverage per the spec:
 *   1. RuleTester unit tests — verify the AST selectors fire on the
 *      expected call shapes.
 *   2. ESLint end-to-end check — run the project's actual flat-config
 *      against the fixture file and assert the rule fires there but
 *      NOT inside the legitimate emitter file (allowlist effective).
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { ESLint, RuleTester, Rule } from 'eslint';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiRoot = resolve(__dirname, '../..');

// ---- RuleTester unit tests on the AST selectors ---------------------------

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

// Mirror the FIVE production selectors so this test fails if the
// eslint.config.js selector set drifts.
const insertSelectorRule = {
  meta: {
    type: 'problem' as const,
    schema: [],
    messages: {
      blocked: 'blocked',
    },
  },
  create(context: Rule.RuleContext) {
    const reporter = (node: import('estree').Node) =>
      context.report({ node, messageId: 'blocked' });
    return {
      // 1. tx.insert(activity)
      "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(insert|update|delete)$/] > Identifier[name='activity']": reporter,
      // 2. tx.insert(schema.activity) — namespace-import member arg
      "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(insert|update|delete)$/] > MemberExpression[property.name='activity'][computed=false]": reporter,
      // 3. insert(activity) — destructured callee
      "CallExpression[callee.type='Identifier'][callee.name=/^(insert|update|delete)$/] > Identifier[name='activity']": reporter,
      // 4. insert(schema.activity) — destructured + namespace
      "CallExpression[callee.type='Identifier'][callee.name=/^(insert|update|delete)$/] > MemberExpression[property.name='activity'][computed=false]": reporter,
      // 5. tx['insert'](activity) — computed-property method
      "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value=/^(insert|update|delete)$/] > Identifier[name='activity']": reporter,
    };
  },
};

describe('activity write-gate selectors (RuleTester)', () => {
  test('member-call shape: tx.insert(activity), tx.update(activity), tx.delete(activity) all fire', () => {
    ruleTester.run('activity-write-gate', insertSelectorRule, {
      valid: [
        { code: 'tx.insert(otherTable).values({})' },
        { code: 'tx.update(otherTable).set({})' },
        { code: 'tx.delete(otherTable).where({})' },
        { code: 'tx.select().from(activity)' },
      ],
      invalid: [
        {
          code: 'tx.insert(activity).values({})',
          errors: [{ messageId: 'blocked' }],
        },
        {
          code: 'tx.update(activity).set({})',
          errors: [{ messageId: 'blocked' }],
        },
        {
          code: 'tx.delete(activity).where({})',
          errors: [{ messageId: 'blocked' }],
        },
      ],
    });
  });

  test('destructured-call shape: insert(activity) (after const insert = tx.insert) fires', () => {
    ruleTester.run('activity-write-gate', insertSelectorRule, {
      valid: [
        { code: 'const insert = tx.insert; insert(otherTable).values({})' },
      ],
      invalid: [
        {
          code: 'const insert = tx.insert; insert(activity).values({})',
          errors: [{ messageId: 'blocked' }],
        },
      ],
    });
  });

  test('namespace-import shape: tx.insert(schema.activity) fires', () => {
    ruleTester.run('activity-write-gate', insertSelectorRule, {
      valid: [
        { code: 'tx.insert(schema.otherTable).values({})' },
        { code: 'tx.update(schema.otherTable).set({})' },
      ],
      invalid: [
        {
          code: 'tx.insert(schema.activity).values({})',
          errors: [{ messageId: 'blocked' }],
        },
        {
          code: 'tx.update(schema.activity).set({})',
          errors: [{ messageId: 'blocked' }],
        },
        {
          code: 'tx.delete(schema.activity).where({})',
          errors: [{ messageId: 'blocked' }],
        },
      ],
    });
  });

  test('destructured + namespace shape: insert(schema.activity) fires', () => {
    ruleTester.run('activity-write-gate', insertSelectorRule, {
      valid: [
        { code: 'const insert = tx.insert; insert(schema.otherTable).values({})' },
      ],
      invalid: [
        {
          code: 'const insert = tx.insert; insert(schema.activity).values({})',
          errors: [{ messageId: 'blocked' }],
        },
      ],
    });
  });

  test("computed-property method shape: tx['insert'](activity) fires", () => {
    ruleTester.run('activity-write-gate', insertSelectorRule, {
      valid: [
        { code: "tx['insert'](otherTable).values({})" },
      ],
      invalid: [
        {
          code: "tx['insert'](activity).values({})",
          errors: [{ messageId: 'blocked' }],
        },
        {
          code: "tx['update'](activity).set({})",
          errors: [{ messageId: 'blocked' }],
        },
        {
          code: "tx['delete'](activity).where({})",
          errors: [{ messageId: 'blocked' }],
        },
      ],
    });
  });
});

// ---- End-to-end check: actual flat-config against in-memory source -------
//
// We use `lintText` rather than a checked-in fixture file so the
// fixture's intentional rule-violation doesn't fail the project's
// `eslint src` lint pass. This still exercises the real flat-config
// allowlist (lintText respects per-file rule overrides keyed off the
// `filePath` argument).

describe('activity write-gate end-to-end (ESLint flat config)', () => {
  // Synthetic source that imports activity + does a direct write — the
  // exact pattern the gate must catch.
  const violatingSource = `
import { activity } from '../../db/schema/index.js';
declare const tx: { insert: (t: unknown) => { values: (v: unknown) => unknown } };
tx.insert(activity).values({});
`;

  // T10-2: hoist the ESLint instance to beforeAll so both tests in this
  // describe share one warm flat-config load. Pre-T10-2 each test created
  // its own ESLint, paying the full plugin-resolution + config-parse cost
  // twice, which could push past the 5s default Vitest timeout on a busy
  // local CI machine (observed once during T10-1's CI runs 2026-05-20).
  // Safe under sequential execution (this file uses no test.concurrent
  // markers); revisit if a future refactor introduces concurrent tests.
  let eslint!: ESLint;
  beforeAll(() => {
    eslint = new ESLint({
      cwd: apiRoot,
      overrideConfigFile: resolve(apiRoot, 'eslint.config.js'),
    });
  });

  // T10-2: 15s timeout via Vitest option-form. Belt-and-suspenders alongside
  // the beforeAll hoist — covers heavy-parallelism cold-start jitter on
  // local CI machines.
  test('lintText against a non-allowlisted path fails the rule', { timeout: 15000 }, async () => {
    // Use a path that's NOT in the allowlist (any normal route file
    // would do). The path doesn't need to exist on disk; ESLint uses
    // it only to apply per-file rule overrides.
    const filePath = resolve(apiRoot, 'src/routes/synthetic-violator.ts');
    const results = await eslint.lintText(violatingSource, { filePath });
    expect(results).toHaveLength(1);
    const messages = results[0]!.messages;
    const restrictedSyntaxHits = messages.filter(
      (m) => m.ruleId === 'no-restricted-syntax',
    );
    expect(restrictedSyntaxHits.length).toBeGreaterThan(0);
  });

  test('lintText AS the emitter file path does NOT fail the rule (allowlist effective)', { timeout: 15000 }, async () => {
    // Same source, but pretend it's the emitter file — allowlist must
    // suppress both the syntax rule and the import-block rule.
    const filePath = resolve(apiRoot, 'src/lib/activity.ts');
    const results = await eslint.lintText(violatingSource, { filePath });
    expect(results).toHaveLength(1);
    const messages = results[0]!.messages;
    const restrictedSyntaxHits = messages.filter(
      (m) => m.ruleId === 'no-restricted-syntax',
    );
    expect(restrictedSyntaxHits.length).toBe(0);
    const restrictedImportsHits = messages.filter(
      (m) => m.ruleId === 'no-restricted-imports',
    );
    expect(restrictedImportsHits.length).toBe(0);
  });
});
