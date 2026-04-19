import { Hono } from 'hono';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { runBackup, backupConfigured } from '../../lib/backup.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST /backup/now — manually trigger a full SQLite → R2 snapshot.
// Same path the nightly cron uses. Handy after a finalize or before a risky
// admin operation.
// ---------------------------------------------------------------------------

app.post('/backup/now', adminAuthMiddleware, async (c) => {
  if (!backupConfigured) {
    return c.json(
      { error: 'Backup bucket not configured', code: 'BACKUP_NOT_CONFIGURED' },
      503,
    );
  }

  try {
    const result = await runBackup();
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Manual backup failed:', err);
    return c.json({ error: message, code: 'BACKUP_FAILED' }, 500);
  }
});

export default app;
