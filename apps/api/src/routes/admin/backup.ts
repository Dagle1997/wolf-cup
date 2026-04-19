import { Hono } from 'hono';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { runBackup, backupConfigured } from '../../lib/backup.js';
import { buildSeasonWorkbook } from '../../lib/season-export.js';
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

// ---------------------------------------------------------------------------
// GET /export/season.xlsx — human-readable weekly mirror for Jason & archive.
// One sheet per finalized round: Player | Gross | Stableford | Money | Sub.
// ---------------------------------------------------------------------------

app.get('/export/season.xlsx', adminAuthMiddleware, async (c) => {
  const yearParam = c.req.query('year');
  const year = yearParam ? Number(yearParam) : undefined;
  if (yearParam && !Number.isInteger(year)) {
    return c.json({ error: 'Invalid year', code: 'VALIDATION_ERROR' }, 400);
  }

  try {
    const { buffer, filename } = await buildSeasonWorkbook(year);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Season export failed:', err);
    return c.json({ error: message, code: 'EXPORT_FAILED' }, 500);
  }
});

export default app;
