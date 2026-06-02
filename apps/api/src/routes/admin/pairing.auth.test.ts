import { describe, it, expect, vi } from 'vitest';

// db is mocked (importing the router pulls it in) but admin-auth is NOT — so we
// can prove pairing-diff is guarded by adminAuthMiddleware (AC8).
vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import pairingApp from './pairing.js';

describe('pairing-diff auth (AC8)', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await pairingApp.request('/rounds/1/pairing-diff', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
