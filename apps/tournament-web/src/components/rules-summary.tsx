/**
 * RulesSummary — a one-line readable summary of the ENABLED Guyan rule
 * modifiers, e.g. "You're playing: Net Skins · Greenies · Polies · Sandies".
 *
 * Disabled (or absent-and-defaulted-off) modifiers are omitted. Built as a
 * standalone component so it can be reused on player-facing screens later.
 *
 * The label map mirrors the four F1 modifier types the engine ships:
 *   net-skins → "Net Skins", greenie → "Greenies",
 *   polie → "Polies", sandie → "Sandies".
 * Any unknown type falls back to its raw `type` string so a future modifier
 * never silently vanishes from the summary.
 */

export type RuleModifier = {
  type: string;
  enabled: boolean;
};

const RULE_LABELS: Record<string, string> = {
  'net-skins': 'Net Skins',
  greenie: 'Greenies',
  polie: 'Polies',
  sandie: 'Sandies',
};

export function ruleLabel(type: string): string {
  return RULE_LABELS[type] ?? type;
}

export function RulesSummary({ modifiers }: { modifiers: RuleModifier[] }) {
  const enabled = modifiers.filter((m) => m.enabled).map((m) => ruleLabel(m.type));
  return (
    <div
      data-testid="rules-summary"
      style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)' }}
    >
      {enabled.length > 0 ? (
        <>
          <span style={{ color: 'var(--color-text-muted)' }}>You&apos;re playing: </span>
          <strong>{enabled.join(' · ')}</strong>
        </>
      ) : (
        <em style={{ color: 'var(--color-text-muted)' }}>No bonus rules enabled.</em>
      )}
    </div>
  );
}
