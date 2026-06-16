/**
 * Pure helpers for "lock handicaps as of a date". Kept dependency-free for
 * unit testing — the GHIN fetch + DB write live in the route.
 */

export type Revision = { revisionDate: string; value: number | null };

/**
 * Pick the handicap index in effect on/before `cutoffDate` from a golfer's
 * revision history: the revision with the LATEST revision_date that is still
 * ≤ the cutoff. Dates compared as YYYY-MM-DD strings (lexicographic = chrono
 * for ISO dates) to sidestep timezone math. Revisions whose value is null are
 * skipped. Returns null if no qualifying revision exists.
 */
export function pickAsOfRevision(
  revisions: Revision[],
  cutoffDate: string,
): Revision | null {
  const cut = cutoffDate.slice(0, 10);
  let best: Revision | null = null;
  let bestDay = '';
  for (const r of revisions) {
    if (r.value == null) continue;
    const day = (r.revisionDate ?? '').slice(0, 10);
    if (day && day <= cut && day >= bestDay) {
      best = r;
      bestDay = day;
    }
  }
  return best;
}

/** YYYY-MM-DD validation for the lock-date input. */
export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
