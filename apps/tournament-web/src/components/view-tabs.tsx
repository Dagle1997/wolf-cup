/**
 * ViewTabs — a Wolf-style segmented tab strip that switches between sibling
 * views of an event (the Standings hub: Leaderboard / Teams / Match; the Money
 * hub: My Money / Money / Settle Up). Replaces the old one-card-per-view clutter
 * on the home screen: each related page now carries this strip at the top so you
 * can flip between them in place.
 *
 * Each tab is a TanStack <Link> (client-side nav) with the active tab
 * highlighted. Mirrors the leaderboard scope toggle's tab markup
 * (role=tablist / role=tab / aria-selected) for a11y + visual consistency.
 */
import { Link } from '@tanstack/react-router';

type TabSet = 'standings' | 'money';

const STANDINGS_TABS = [
  { key: 'leaderboard', label: 'Leaderboard', to: '/events/$eventId/leaderboard' },
  { key: 'teams', label: 'Teams', to: '/events/$eventId/team-standings' },
  { key: 'match', label: 'Match', to: '/events/$eventId/match-play-standings' },
  { key: 'action', label: 'Action', to: '/events/$eventId/action' },
] as const;

const MONEY_TABS = [
  { key: 'my-money', label: 'My Money', to: '/events/$eventId/my-money' },
  { key: 'money', label: 'Money', to: '/events/$eventId/money' },
  { key: 'settle', label: 'Settle Up', to: '/events/$eventId/settle-up' },
] as const;

export function ViewTabs({
  set,
  active,
  eventId,
}: {
  set: TabSet;
  /** The `key` of the active tab in the chosen set. */
  active: string;
  eventId: string;
}) {
  const tabs = set === 'standings' ? STANDINGS_TABS : MONEY_TABS;
  return (
    <div
      role="tablist"
      aria-label={set === 'standings' ? 'Standings views' : 'Money views'}
      style={{
        display: 'flex',
        gap: 0,
        marginBottom: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            to={t.to}
            params={{ eventId }}
            role="tab"
            aria-selected={isActive}
            data-testid={`viewtab-${t.key}`}
            style={{
              flex: 1,
              textAlign: 'center',
              minHeight: 'var(--control-height)',
              lineHeight: 'var(--control-height)',
              fontSize: 'var(--font-sm)',
              fontWeight: 600,
              textDecoration: 'none',
              color: isActive ? '#fff' : 'var(--color-text-secondary)',
              backgroundColor: isActive ? 'var(--color-brand-primary)' : 'var(--color-surface)',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
