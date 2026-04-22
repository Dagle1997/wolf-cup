import { describe, expect, test } from 'vitest';
import { authRouter } from './auth.js';

describe('auth router stub (T1-6a)', () => {
  test('GET /status returns the placeholder payload', async () => {
    const res = await authRouter.request('/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: string; oauth: string };
    expect(body).toEqual({ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' });
  });
});
