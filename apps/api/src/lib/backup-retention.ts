// ---------------------------------------------------------------------------
// Backup retention — pure logic, no IO. Decides which R2 backup keys to keep.
// ---------------------------------------------------------------------------
//
// Key format: backups/wolf-cup-YYYY-MM-DD-HHMMSSZ.db.gz
//   e.g.       backups/wolf-cup-2026-04-19-030000Z.db.gz
//
// Keep rules (any match keeps the key):
//   - within the last 365 days
//   - OR date is the 1st of a month (permanent monthly anchor)
// Otherwise the key is marked for deletion.
//
// Unknown / non-matching keys are NEVER returned in deleteKeys. If a human drops
// a stray object in the bucket, the pruner leaves it alone.
// ---------------------------------------------------------------------------

export interface RetentionPlan {
  keep: string[];
  deleteKeys: string[];
}

const KEY_RE = /^backups\/wolf-cup-(\d{4})-(\d{2})-(\d{2})-\d{6}Z\.db\.gz$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 365;

interface ParsedKey {
  key: string;
  epochDay: number;
  dayOfMonth: number;
}

function parseKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return {
    key,
    epochDay: Math.floor(d.getTime() / DAY_MS),
    dayOfMonth: day,
  };
}

function startOfDayUTC(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}

export function planRetention(keys: string[], today: Date): RetentionPlan {
  const todayEpoch = startOfDayUTC(today);
  const dailyCutoff = todayEpoch - DAILY_DAYS;

  const parsed: ParsedKey[] = [];
  for (const k of keys) {
    const p = parseKey(k);
    if (p) parsed.push(p);
  }

  const keep: string[] = [];
  const deleteKeys: string[] = [];
  for (const p of parsed) {
    const isRecent = p.epochDay >= dailyCutoff;
    const isMonthAnchor = p.dayOfMonth === 1;
    if (isRecent || isMonthAnchor) {
      keep.push(p.key);
    } else {
      deleteKeys.push(p.key);
    }
  }

  return { keep, deleteKeys };
}

export function buildBackupKey(now: Date): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  return `backups/wolf-cup-${y}-${mo}-${d}-${h}${mi}${s}Z.db.gz`;
}
