import { describe, expect, test } from 'vitest';
import { app } from './app.js';

describe('app', () => {
  test('GET /api/health returns ok + startupTime', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; startupTime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.startupTime).toBe('number');
    expect(Number.isInteger(body.startupTime)).toBe(true);
    expect(body.startupTime).toBeGreaterThan(0);
  });
});
