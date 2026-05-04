/**
 * T6-5 — formatCents.
 *
 * Sole conversion of integer cents → human-readable `$X.XX` string at the UI
 * render boundary. Throws on non-integer input to enforce integer-cents
 * discipline (T6 epic invariant — engine + service + DB are integer cents;
 * floats only enter at display time).
 */
export function formatCents(n: number): string {
  if (!Number.isInteger(n)) {
    throw new RangeError(`formatCents expects an integer cents value (got ${n})`);
  }
  if (n === 0) return '$0.00';
  const sign = n > 0 ? '+' : '-';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}$${dollars}.${cents.toString().padStart(2, '0')}`;
}
