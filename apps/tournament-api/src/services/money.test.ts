/**
 * T6-5 money service shape-only sanity tests.
 *
 * The full integration coverage lives in routes/money.integration.test.ts
 * — it seeds a real event + rounds + scores and verifies actual aggregation.
 * This file just verifies the service module's exported surface matches the
 * spec.
 */
import { describe, expect, test } from 'vitest';

describe('money service exports', () => {
  test('exports computeMoneyMatrix', async () => {
    const mod = await import('./money.js');
    expect(typeof mod.computeMoneyMatrix).toBe('function');
  });

  test('re-exported from services barrel', async () => {
    const mod = await import('./index.js');
    expect(typeof (mod as { computeMoneyMatrix?: unknown }).computeMoneyMatrix).toBe('function');
  });
});
