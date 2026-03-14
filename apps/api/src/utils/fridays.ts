/**
 * Format a Date as YYYY-MM-DD using local date parts (not UTC).
 */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calculate all Fridays between two ISO date strings (inclusive).
 * Both dates must be Fridays; throws if not.
 */
export function getFridaysInRange(startDate: string, endDate: string): string[] {
  const start = new Date(startDate + 'T12:00:00'); // noon to avoid TZ issues
  const end = new Date(endDate + 'T12:00:00');

  if (start.getDay() !== 5) {
    throw new Error('Start date must be a Friday');
  }
  if (end.getDay() !== 5) {
    throw new Error('End date must be a Friday');
  }
  if (start > end) {
    throw new Error('Start date must be before or equal to end date');
  }

  const fridays: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    fridays.push(toISODate(current));
    current.setDate(current.getDate() + 7);
  }

  return fridays;
}
