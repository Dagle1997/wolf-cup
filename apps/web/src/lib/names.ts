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

/**
 * Always-disambiguated display name: "First L." (last initial), falling back to
 * the first name when there's no last name. Use where first-name-only is
 * ambiguous regardless of who else is on screen — e.g. CTP winners, since the
 * league has several players sharing a first name.
 */
export function nameWithInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? fullName;
  if (parts.length < 2) return first;
  return `${first} ${parts[parts.length - 1]![0]}.`;
}
