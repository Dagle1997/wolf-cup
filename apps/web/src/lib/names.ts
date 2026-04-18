/**
 * Short display name — first name, plus last initial if another player
 * in the context shares the same first name (e.g. "Matt W." vs "Matt J.").
 *
 * Pass the set of names that form the disambiguation context (a group's
 * 4 players, the active roster, etc.). Collisions outside that context
 * won't trigger a last-initial suffix.
 */
export function shortName(fullName: string, contextNames: readonly string[]): string {
  const parts = fullName.split(' ');
  const first = parts[0]!;
  const hasDuplicate = contextNames.some(
    (n) => n !== fullName && n.split(' ')[0] === first,
  );
  if (hasDuplicate && parts.length > 1) {
    return `${first} ${parts[parts.length - 1]![0]}.`;
  }
  return first;
}
