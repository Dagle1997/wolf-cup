/**
 * Per-foursome Guyan rules (Epic 6) — /admin/events/$eventId/foursome-rules.
 *
 * Different foursomes can play different rules in the SAME money event. The
 * organizer sets each foursome's Guyan modifiers (and an optional stake) here;
 * the rules are frozen into the round pin at start and settle per foursome.
 *
 * One editor per (round, foursome). A foursome with no override INHERITS the
 * event default (badge: "Event default"); saving creates an override ("Custom");
 * "Use event default" clears it. Requires pairings to be saved first (the
 * foursome must exist as a pairing). Locked money mode is fine — per-foursome
 * overrides apply at pin time regardless of the cascade lock.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { RulesSummary } from '../components/rules-summary';

type ModifierVariant = { basis?: 'net' | 'gross'; bonus?: 'single' | 'double'; carryover?: boolean };
type ModifierType = 'net-skins' | 'greenie' | 'polie' | 'sandie';
type Modifier = { type: ModifierType; enabled: boolean; variant?: ModifierVariant };

const RULE_TYPES: ReadonlyArray<{ type: ModifierType; label: string }> = [
  { type: 'net-skins', label: 'Net Skins' },
  { type: 'greenie', label: 'Greenies' },
  { type: 'polie', label: 'Polies' },
  { type: 'sandie', label: 'Sandies' },
];
function defaultVariant(type: ModifierType): ModifierVariant | undefined {
  if (type === 'net-skins') return { basis: 'net', bonus: 'single' };
  if (type === 'greenie') return { carryover: true };
  return undefined;
}

type ConfigJson = { pointValueSchedule: { kind: string; cents?: number }; modifiers?: Modifier[] };
type ConfigRow = { configJson: string } | null;

type PairingsResponse = {
  rounds: Array<{ eventRoundId: string; roundNumber: number; pairings: Array<{ foursomeNumber: number }> }>;
};

function hydrate(cfg: ConfigJson | null): { enabled: Record<ModifierType, boolean>; variants: Record<ModifierType, ModifierVariant | undefined>; stake: number } {
  const enabled: Record<ModifierType, boolean> = { 'net-skins': true, greenie: true, polie: true, sandie: true };
  const variants: Record<ModifierType, ModifierVariant | undefined> = {
    'net-skins': defaultVariant('net-skins'), greenie: defaultVariant('greenie'), polie: undefined, sandie: undefined,
  };
  let stake = 5;
  if (cfg) {
    const byType = new Map((cfg.modifiers ?? []).map((m) => [m.type, m] as const));
    for (const { type } of RULE_TYPES) {
      const m = byType.get(type);
      if (m) { enabled[type] = m.enabled; variants[type] = m.variant ?? defaultVariant(type); }
    }
    if (cfg.pointValueSchedule?.kind === 'flat' && typeof cfg.pointValueSchedule.cents === 'number') {
      stake = Math.round(cfg.pointValueSchedule.cents / 100);
    }
  }
  return { enabled, variants, stake };
}

function FoursomeRuleEditor({ eventId, eventRoundId, foursomeNumber }: { eventId: string; eventRoundId: string; foursomeNumber: number }) {
  const qc = useQueryClient();
  const key = ['foursome-config', eventId, eventRoundId, foursomeNumber] as const;
  const url = `/api/admin/events/${encodeURIComponent(eventId)}/rounds/${encodeURIComponent(eventRoundId)}/foursomes/${foursomeNumber}/game-config`;
  const query = useQuery<{ foursomeConfig: ConfigRow; eventConfig: ConfigRow }, Error>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as { foursomeConfig: ConfigRow; eventConfig: ConfigRow };
    },
    retry: false,
  });

  const [enabled, setEnabled] = useState<Record<ModifierType, boolean>>({ 'net-skins': true, greenie: true, polie: true, sandie: true });
  const [variants, setVariants] = useState<Record<ModifierType, ModifierVariant | undefined>>({ 'net-skins': defaultVariant('net-skins'), greenie: defaultVariant('greenie'), polie: undefined, sandie: undefined });
  const [stake, setStake] = useState(5);
  const isCustom = query.data?.foursomeConfig != null;

  useEffect(() => {
    if (!query.data) return;
    const row = query.data.foursomeConfig ?? query.data.eventConfig;
    let cfg: ConfigJson | null = null;
    if (row) { try { cfg = JSON.parse(row.configJson) as ConfigJson; } catch { cfg = null; } }
    const h = hydrate(cfg);
    setEnabled(h.enabled); setVariants(h.variants); setStake(h.stake);
  }, [query.data]);

  const save = useMutation<void, Error, void>({
    mutationFn: async () => {
      const modifiers: Modifier[] = RULE_TYPES.map(({ type }) => {
        const v = variants[type];
        const m: Modifier = { type, enabled: enabled[type] };
        if (v !== undefined) m.variant = v;
        return m;
      });
      const res = await fetch(url, {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modifiers, pointValueSchedule: { kind: 'flat', cents: Math.round(stake) * 100 } }),
      });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { code?: string }; throw new Error(b.code ?? `http_${res.status}`); }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const reset = useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error(`http_${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (query.isPending) return <Card style={{ marginBottom: 12 }}><LoadingCard /></Card>;
  if (query.isError) return <Card style={{ marginBottom: 12 }}><ErrorCard error={`Couldn't load foursome ${foursomeNumber}.`} onRetry={query.refetch} /></Card>;

  return (
    <Card data-testid={`foursome-rules-${eventRoundId}-${foursomeNumber}`} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Foursome {foursomeNumber}</strong>
        <span
          data-testid={`foursome-badge-${eventRoundId}-${foursomeNumber}`}
          style={{ fontSize: 'var(--font-xs)', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-md)', background: isCustom ? 'var(--color-brand-primary)' : 'var(--color-surface-sunken)', color: isCustom ? '#0a0a0a' : 'var(--color-text-muted)' }}
        >
          {isCustom ? 'Custom' : 'Event default'}
        </span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <RulesSummary modifiers={RULE_TYPES.map(({ type }) => ({ type, enabled: enabled[type] }))} />
      </div>
      {RULE_TYPES.map(({ type, label }) => {
        const on = enabled[type];
        return (
          <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            <button
              type="button" role="switch" aria-checked={on}
              data-testid={`foursome-toggle-${eventRoundId}-${foursomeNumber}-${type}`}
              aria-label={`${on ? 'Disable' : 'Enable'} ${label} for foursome ${foursomeNumber}`}
              onClick={() => setEnabled((p) => ({ ...p, [type]: !p[type] }))}
              style={{ minHeight: 44, minWidth: 64, padding: '0 14px', borderRadius: 'var(--radius-md)', fontWeight: 700, fontSize: 'var(--font-sm)', cursor: 'pointer', border: `1px solid ${on ? 'var(--color-brand-primary)' : 'var(--color-border)'}`, background: on ? 'var(--color-brand-primary)' : 'transparent', color: on ? '#0a0a0a' : 'var(--color-text-muted)' }}
            >
              {on ? 'On' : 'Off'}
            </button>
          </div>
        );
      })}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, marginTop: 4 }}>
        <span style={{ fontWeight: 600 }}>$ / point</span>
        <input type="number" min={1} step={1} data-testid={`foursome-stake-${eventRoundId}-${foursomeNumber}`} value={stake} onChange={(e) => setStake(Number(e.target.value))} style={{ minHeight: 36, width: 80 }} />
      </label>
      {save.isError ? <p role="alert" style={{ color: 'var(--color-danger)' }}>Couldn&apos;t save ({save.error.message}).</p> : null}
      {save.isSuccess ? <p role="status" style={{ color: 'var(--color-brand-primary)' }}>Saved.</p> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button data-testid={`foursome-save-${eventRoundId}-${foursomeNumber}`} disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save rules'}
        </Button>
        {isCustom ? (
          <Button data-testid={`foursome-reset-${eventRoundId}-${foursomeNumber}`} disabled={reset.isPending} onClick={() => reset.mutate()} style={{ background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
            Use event default
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function FoursomeRulesPage({ eventId }: { eventId: string }) {
  const query = useQuery<PairingsResponse, Error>({
    queryKey: ['event-pairings-rules', eventId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pairings`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as PairingsResponse;
    },
    retry: false,
  });

  if (query.isPending) {
    return <PageShell title="Foursome rules"><BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" /><LoadingCard /></PageShell>;
  }
  if (query.isError) {
    return <PageShell title="Foursome rules"><BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" /><ErrorCard error="Couldn't load foursomes." onRetry={query.refetch} /></PageShell>;
  }

  const rounds = query.data!.rounds.filter((r) => r.pairings.length > 0);

  return (
    <PageShell title="Foursome rules">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
      <Card data-testid="foursome-rules-intro" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
          Each foursome inherits the event&apos;s Standard Guyan rules. Override any
          foursome that plays differently — frozen when the round starts, settled
          per foursome. Set pairings first if a round shows none.
        </div>
      </Card>
      {rounds.length === 0 ? (
        <Card><p>No foursomes yet. Set up pairings first.</p></Card>
      ) : (
        rounds.map((r) => (
          <div key={r.eventRoundId} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 'var(--font-lg)', marginBottom: 8 }}>Round {r.roundNumber}</h2>
            {[...r.pairings]
              .sort((a, b) => a.foursomeNumber - b.foursomeNumber)
              .map((p) => (
                <FoursomeRuleEditor key={p.foursomeNumber} eventId={eventId} eventRoundId={r.eventRoundId} foursomeNumber={p.foursomeNumber} />
              ))}
          </div>
        ))
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/foursome-rules')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <FoursomeRulesPage eventId={eventId} />;
}
