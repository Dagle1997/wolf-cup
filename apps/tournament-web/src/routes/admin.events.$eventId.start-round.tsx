/**
 * T13-2 Start Round — organizer instantiates scoring for an event_round.
 *
 * Reads the persisted pairings (GET /api/admin/events/:eventId/pairings),
 * shows each round whose pairings are ALL locked, lets the organizer pick a
 * scorer per foursome (the foursome's members + the organizer themself), and
 * POSTs /api/admin/event-rounds/:eventRoundId/start. On success it links to
 * score-entry for the new round.
 *
 * Read-only against the pairings editor (no shared edit state) — deliberately
 * a separate route so it can't disturb the pairings-save flow.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { useAuthSession } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

type PairingsResponse = {
  rounds: Array<{
    eventRoundId: string;
    roundNumber: number;
    pairings: Array<{
      foursomeNumber: number;
      locked: boolean;
      members: Array<{ playerId: string; name: string }>;
    }>;
  }>;
};

async function fetchPairings(eventId: string): Promise<PairingsResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pairings`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as PairingsResponse;
}

type Policy = 'foursome' | 'designated' | 'open';
type ScorerPolicyResponse = {
  policy: Policy;
  designatedPlayerIds: string[];
  roster: Array<{ playerId: string; name: string | null }>;
};

async function fetchScorerPolicy(eventId: string): Promise<ScorerPolicyResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/scorer-policy`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as ScorerPolicyResponse;
}

const ORGANIZER = '__organizer__';

export function StartRoundPage({ eventId, organizerId }: { eventId: string; organizerId: string }) {
  const navigate = useNavigate();
  const query = useQuery<PairingsResponse, Error>({
    queryKey: ['start-round-pairings', eventId],
    queryFn: () => fetchPairings(eventId),
    retry: false,
  });
  // The policy decides which players are offered as a foursome's scorer. The
  // server still validates; this keeps the picker honest (e.g. shows the
  // designated caddie pool under 'designated', the whole roster under 'open').
  const policyQuery = useQuery<ScorerPolicyResponse, Error>({
    queryKey: ['scorer-policy', eventId],
    queryFn: () => fetchScorerPolicy(eventId),
    retry: false,
  });

  // Per (eventRoundId, foursomeNumber) → selected scorerPlayerId (or ORGANIZER sentinel).
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  // The eventRoundId the organizer is confirming (one-way action → confirm step).
  const [confirming, setConfirming] = useState<string | null>(null);
  // The eventRoundId the server flagged as having no game/money rules configured
  // (422 no_game_config). Shows a scores-only confirmation instead of starting.
  const [noGamePrompt, setNoGamePrompt] = useState<string | null>(null);
  // The eventRoundId the server flagged as having NO greenie/polie/sandie enabled
  // for any foursome (422 no_claim_modifiers). Shows a "set the rules or start
  // without bonuses" confirmation — the post-trip fix for "modifiers didn't show".
  const [noModifiersPrompt, setNoModifiersPrompt] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <PageShell title="Start round">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Start round">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load pairings." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const startableRounds = query.data.rounds.filter(
    (r) => r.pairings.length > 0 && r.pairings.every((p) => p.locked),
  );

  async function start(
    eventRoundId: string,
    foursomes: PairingsResponse['rounds'][number]['pairings'],
    confirmNoGame = false,
    confirmNoModifiers = false,
  ) {
    setErrorText(null);
    // Clear any prior pre-flight prompt before a fresh attempt so a stale one
    // can never mask the surface this attempt should show.
    setNoGamePrompt(null);
    setNoModifiersPrompt(null);
    setBusy(eventRoundId);
    try {
      const scorers = foursomes.map((p) => {
        const key = `${eventRoundId}:${p.foursomeNumber}`;
        const pick = picks[key] ?? ORGANIZER;
        return {
          foursomeNumber: p.foursomeNumber,
          scorerPlayerId: pick === ORGANIZER ? organizerId : pick,
        };
      });
      const res = await fetch(
        `/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/start`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scorers,
            ...(confirmNoGame ? { confirmNoGame: true } : {}),
            ...(confirmNoModifiers ? { confirmNoModifiers: true } : {}),
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        // No game/money rules configured → don't start silently; surface a
        // scores-only confirmation so the organizer can set rules first.
        if (body.code === 'no_game_config') {
          setConfirming(null);
          setNoGamePrompt(eventRoundId);
          return;
        }
        // F1 event configured, but no greenie/polie/sandie are enabled for any
        // foursome → players would see no bonus buttons. Surface a prompt to
        // set the rules first, or start without bonuses (post-trip fix).
        if (body.code === 'no_claim_modifiers') {
          setConfirming(null);
          setNoModifiersPrompt(eventRoundId);
          return;
        }
        setErrorText(
          body.code === 'pairings_not_ready'
            ? 'Lock every foursome before starting the round.'
            : `Couldn't start the round (${body.code ?? res.status}).`,
        );
        return;
      }
      const { roundId } = (await res.json()) as { roundId: string };
      void navigate({ to: '/rounds/$roundId/score-entry', params: { roundId } });
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell title="Start round">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />

      {errorText !== null ? <p role="alert" style={{ color: 'var(--color-danger)' }}>{errorText}</p> : null}

      {startableRounds.length === 0 ? (
        <EmptyState
          title="No round is ready to start."
          body="Set foursomes and lock every one of them on the Pairings page first."
          action={
            <Link to="/admin/events/$eventId/pairings" params={{ eventId }}>
              Go to Pairings
            </Link>
          }
        />
      ) : (
        startableRounds.map((r) => {
          const isConfirming = confirming === r.eventRoundId;
          const foursomeCount = r.pairings.length;
          return (
          <section key={r.eventRoundId} className="card" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }} data-testid={`start-round-${r.eventRoundId}`}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>Round {r.roundNumber}</h2>
              <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>{foursomeCount} foursome{foursomeCount === 1 ? '' : 's'}</span>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)', marginTop: 4 }}>
              Pick who scores each foursome (they must be able to sign in). Defaults to you.
            </p>
            {r.pairings
              .slice()
              .sort((a, b) => a.foursomeNumber - b.foursomeNumber)
              .map((p) => {
                const key = `${r.eventRoundId}:${p.foursomeNumber}`;
                const memberNames = p.members.map((m) => m.name).filter(Boolean).join(', ');
                return (
                  <div key={key} style={{ margin: 'var(--space-3) 0', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)' }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--font-sm)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
                      Foursome {p.foursomeNumber}
                    </div>
                    {/* Context: who's actually playing in this foursome. */}
                    <div style={{ fontSize: 'var(--font-sm)', margin: '2px 0 var(--space-2)', overflowWrap: 'break-word', wordBreak: 'break-word' }}>{memberNames || '—'}</div>
                    <label htmlFor={`scorer-sel-${key}`} style={{ display: 'block', fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', marginBottom: 2 }}>Scorer</label>
                    <select
                      id={`scorer-sel-${key}`}
                      data-testid={`scorer-${key}`}
                      value={picks[key] ?? ORGANIZER}
                      onChange={(e) => setPicks((prev) => ({ ...prev, [key]: e.target.value }))}
                      disabled={isConfirming}
                      style={{ width: '100%', minHeight: 'var(--control-height)' }}
                    >
                      <option value={ORGANIZER}>You (organizer)</option>
                      {(() => {
                        const pol = policyQuery.data;
                        let opts: Array<{ playerId: string; name: string | null }> = p.members;
                        if (pol) {
                          if (pol.policy === 'open') opts = pol.roster;
                          else if (pol.policy === 'designated')
                            opts = pol.roster.filter((r) => pol.designatedPlayerIds.includes(r.playerId));
                        }
                        return opts.map((m) => (
                          <option key={m.playerId} value={m.playerId}>
                            {m.name ?? '—'}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                );
              })}

            {noGamePrompt === r.eventRoundId ? (
              <div style={{ marginTop: 'var(--space-4)' }} data-testid={`no-game-prompt-${r.eventRoundId}`}>
                <div role="alert" style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                  <span aria-hidden>⚠ </span><strong>No game or money rules are set for this event.</strong> If you
                  start now, players won&apos;t see greenies / polies / sandies or any money. Set them up first, or
                  start a scores-only round.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  <Link
                    to="/admin/events/$eventId/game-config"
                    params={{ eventId }}
                    data-testid={`go-game-config-${r.eventRoundId}`}
                    style={{ flex: 1, minWidth: 160, minHeight: 'var(--control-height-lg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-brand-primary)', color: '#fff', fontWeight: 700, borderRadius: 'var(--radius-md)', textDecoration: 'none' }}
                  >
                    Set up Rules &amp; Games
                  </Link>
                  <button
                    type="button"
                    data-testid={`start-scores-only-${r.eventRoundId}`}
                    disabled={busy === r.eventRoundId}
                    onClick={() => start(r.eventRoundId, r.pairings, true)}
                    style={{ flex: 1, minWidth: 160, minHeight: 'var(--control-height-lg)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', fontWeight: 600 }}
                  >
                    {busy === r.eventRoundId ? 'Starting…' : 'Start scores-only'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setNoGamePrompt(null)}
                  style={{ marginTop: 'var(--space-2)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, fontSize: 'var(--font-sm)' }}
                >
                  Cancel
                </button>
              </div>
            ) : noModifiersPrompt === r.eventRoundId ? (
              <div style={{ marginTop: 'var(--space-4)' }} data-testid={`no-modifiers-prompt-${r.eventRoundId}`}>
                <div role="alert" style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                  <span aria-hidden>⚠ </span><strong>No bonuses (greenie / polie / sandie) are turned on for any group.</strong> If you
                  start now, scorers won&apos;t see bonus buttons. Set the rules first — at the event level or per foursome — or start without bonuses.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  <Link
                    to="/admin/events/$eventId/game-config"
                    params={{ eventId }}
                    data-testid={`go-game-config-modifiers-${r.eventRoundId}`}
                    style={{ flex: 1, minWidth: 140, minHeight: 'var(--control-height-lg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-brand-primary)', color: '#fff', fontWeight: 700, borderRadius: 'var(--radius-md)', textDecoration: 'none' }}
                  >
                    Event rules
                  </Link>
                  <Link
                    to="/admin/events/$eventId/foursome-rules"
                    params={{ eventId }}
                    data-testid={`go-foursome-rules-${r.eventRoundId}`}
                    style={{ flex: 1, minWidth: 140, minHeight: 'var(--control-height-lg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', fontWeight: 700, borderRadius: 'var(--radius-md)', textDecoration: 'none' }}
                  >
                    Foursome rules
                  </Link>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <button
                    type="button"
                    data-testid={`start-without-bonuses-${r.eventRoundId}`}
                    disabled={busy === r.eventRoundId}
                    onClick={() => start(r.eventRoundId, r.pairings, false, true)}
                    style={{ flex: 1, minWidth: 160, minHeight: 'var(--control-height-lg)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', fontWeight: 600 }}
                  >
                    {busy === r.eventRoundId ? 'Starting…' : 'Start without bonuses'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setNoModifiersPrompt(null)}
                  style={{ marginTop: 'var(--space-2)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, fontSize: 'var(--font-sm)' }}
                >
                  Cancel
                </button>
              </div>
            ) : isConfirming ? (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div role="alert" style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                  <span aria-hidden>⚠ </span>This opens scoring for Round {r.roundNumber} and locks the lineup. You can&apos;t undo it.
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={busy === r.eventRoundId}
                    style={{ minHeight: 'var(--control-height-lg)', flexShrink: 0 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid={`confirm-start-${r.eventRoundId}`}
                    disabled={busy === r.eventRoundId}
                    onClick={() => start(r.eventRoundId, r.pairings)}
                    style={{ flex: 1, minHeight: 'var(--control-height-lg)', background: 'var(--color-brand-primary)', color: '#fff', fontWeight: 700, border: 'none' }}
                  >
                    {busy === r.eventRoundId ? 'Starting…' : `Yes, start Round ${r.roundNumber}`}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid={`start-btn-${r.eventRoundId}`}
                disabled={busy === r.eventRoundId}
                onClick={() => setConfirming(r.eventRoundId)}
                style={{ width: '100%', minHeight: 'var(--control-height-lg)', marginTop: 'var(--space-3)', background: 'var(--color-brand-primary)', color: '#fff', fontWeight: 700, border: 'none' }}
              >
                Start round
              </button>
            )}
          </section>
          );
        })
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/start-round')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const { player } = useAuthSession();
  return <StartRoundPage eventId={eventId} organizerId={player?.id ?? ''} />;
}
