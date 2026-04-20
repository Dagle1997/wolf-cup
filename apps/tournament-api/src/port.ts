/**
 * Resolve a port number from a raw env-var string.
 *
 * Returns 3000 if the input is missing or invalid. Invalid means:
 * contains anything other than ASCII digits (no sign, no decimal
 * point, no scientific notation, no whitespace, no trailing junk),
 * or resolves to an integer outside [1, 65535]. Invalid inputs emit
 * a `console.warn` before falling back.
 *
 * The strict regex guard exists because `Number.parseInt` is
 * permissive — `parseInt('3001abc', 10)` returns 3001, which would
 * cause the server to misbind to an unintended port. The AC requires
 * rejection of non-numeric inputs, so the regex is the source of
 * truth for "numeric", not `parseInt`.
 *
 * Extracted to its own module so tests can exercise each branch
 * without importing `src/index.ts` (which calls `serve()` at module
 * scope and binds a port).
 */
export function resolvePort(
  raw: string | undefined = process.env['PORT'],
): number {
  if (!raw) return 3000;
  if (!/^\d+$/.test(raw)) {
    console.warn(`Invalid PORT="${raw}"; falling back to 3000`);
    return 3000;
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed <= 0 || parsed > 65535) {
    console.warn(`Invalid PORT="${raw}"; falling back to 3000`);
    return 3000;
  }
  return parsed;
}
