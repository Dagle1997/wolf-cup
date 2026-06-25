/**
 * F1 "Rules & Games" setup page (Story 1.3) — preset-first event default.
 *
 * Route: /admin/events/:eventId/game-config
 *
 * The organizer starts from the Standard Guyan preset (never a blank slate),
 * picks a point value (single $X or a front/back $X/$Y split) and a lock state,
 * and Saves via PUT /api/admin/events/:eventId/game-config. The first save
 * SEEDS the event default; later saves UPDATE it. Built from the shared
 * Button / Card / FormField primitives with dark-mode tokens + ≥44px taps.
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
import { FormField } from '../components/form-field';
import { RulesSummary } from '../components/rules-summary';

type PointValueSchedule =
  | { kind: 'flat'; cents: number }
  | { kind: 'front-back'; frontCents: number; backCents: number };

// F1 rule modifiers (Epic 2). The engine ships four; each carries an optional
// `variant` we must preserve on save (net-skins basis/bonus, greenie carryover).
type ModifierVariant = {
  basis?: 'net' | 'gross';
  bonus?: 'single' | 'double';
  carryover?: boolean;
};
type ModifierType = 'net-skins' | 'greenie' | 'polie' | 'sandie';
type Modifier = {
  type: ModifierType;
  enabled: boolean;
  variant?: ModifierVariant;
};

// The four modifiers in display order. Standard Guyan now ships all four ON, so
// a type absent from the saved config defaults ON (see hydration below).
const RULE_TYPES: ReadonlyArray<{ type: ModifierType; label: string }> = [
  { type: 'net-skins', label: 'Net Skins' },
  { type: 'greenie', label: 'Greenies' },
  { type: 'polie', label: 'Polies' },
  { type: 'sandie', label: 'Sandies' },
];

/** Default variant for a modifier type (used when seeding a fresh config). */
function defaultVariant(type: ModifierType): ModifierVariant | undefined {
  // Net Skins is net-basis, single-bonus today. (Gross basis = future; the
  // engine only supports net, so we never expose a net/gross control here.)
  if (type === 'net-skins') return { basis: 'net', bonus: 'single' };
  // Greenie defaults to carryover ON.
  if (type === 'greenie') return { carryover: true };
  // polie / sandie have no variant.
  return undefined;
}

type GameConfigJson = {
  game: string;
  pointValueSchedule: PointValueSchedule;
  lockState?: 'locked' | 'unlocked';
  modifiers?: Modifier[];
};

type GameConfigRow = {
  id: string;
  lockState: 'locked' | 'unlocked' | null;
  configVersion: number;
  configJson: string;
};

type GameConfigResponse = { config: GameConfigRow | null };

async function fetchGameConfig(eventId: string): Promise<GameConfigResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/game-config`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as GameConfigResponse;
}

/** Dollars (whole) → even cents. The engine rejects odd/negative cents. */
function dollarsToCents(dollars: number): number {
  return Math.round(dollars) * 100;
}

export function GameConfigPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const query = useQuery<GameConfigResponse, Error>({
    queryKey: ['game-config', eventId],
    queryFn: () => fetchGameConfig(eventId),
    retry: false,
  });

  const [mode, setMode] = useState<'flat' | 'front-back'>('flat');
  const [flatDollars, setFlatDollars] = useState(5);
  const [frontDollars, setFrontDollars] = useState(5);
  const [backDollars, setBackDollars] = useState(10);
  const [lockState, setLockState] = useState<'locked' | 'unlocked'>('locked');

  // Rule modifiers. enabled[type] = whether that rule is ON; variants[type] =
  // the modifier's existing variant (preserved across save). Standard Guyan
  // ships all four ON, so an unseeded config / absent type defaults ON.
  const [ruleEnabled, setRuleEnabled] = useState<Record<ModifierType, boolean>>({
    'net-skins': true,
    greenie: true,
    polie: true,
    sandie: true,
  });
  const [ruleVariants, setRuleVariants] = useState<Record<ModifierType, ModifierVariant | undefined>>(
    {
      'net-skins': defaultVariant('net-skins'),
      greenie: defaultVariant('greenie'),
      polie: undefined,
      sandie: undefined,
    },
  );

  // Hydrate the controls from the saved config once loaded.
  useEffect(() => {
    const row = query.data?.config;
    if (!row) return;
    setLockState(row.lockState ?? 'locked');
    try {
      const cfg = JSON.parse(row.configJson) as GameConfigJson;
      const sched = cfg.pointValueSchedule;
      if (sched.kind === 'flat') {
        setMode('flat');
        setFlatDollars(Math.round(sched.cents / 100));
      } else {
        setMode('front-back');
        setFrontDollars(Math.round(sched.frontCents / 100));
        setBackDollars(Math.round(sched.backCents / 100));
      }
      // Hydrate rule toggles + variants. A type absent from the config defaults
      // ON (Standard Guyan now ships all four). Variants are preserved so save
      // round-trips net-skins {basis,bonus} and greenie {carryover} untouched.
      const byType = new Map((cfg.modifiers ?? []).map((m) => [m.type, m] as const));
      const nextEnabled: Record<ModifierType, boolean> = {
        'net-skins': true,
        greenie: true,
        polie: true,
        sandie: true,
      };
      const nextVariants: Record<ModifierType, ModifierVariant | undefined> = {
        'net-skins': defaultVariant('net-skins'),
        greenie: defaultVariant('greenie'),
        polie: undefined,
        sandie: undefined,
      };
      for (const { type } of RULE_TYPES) {
        const m = byType.get(type);
        if (m) {
          nextEnabled[type] = m.enabled;
          nextVariants[type] = m.variant ?? defaultVariant(type);
        }
      }
      setRuleEnabled(nextEnabled);
      setRuleVariants(nextVariants);
    } catch {
      /* keep defaults on a malformed config */
    }
  }, [query.data]);

  const save = useMutation<GameConfigResponse, Error, void>({
    mutationFn: async () => {
      const pointValueSchedule: PointValueSchedule =
        mode === 'flat'
          ? { kind: 'flat', cents: dollarsToCents(flatDollars) }
          : { kind: 'front-back', frontCents: dollarsToCents(frontDollars), backCents: dollarsToCents(backDollars) };
      // Build the FULL modifiers array — the backend treats a present
      // `modifiers` as authoritative, so we always send all four with their
      // preserved variants and per-toggle `enabled`.
      const modifiers: Modifier[] = RULE_TYPES.map(({ type }) => {
        const variant = ruleVariants[type];
        const m: Modifier = { type, enabled: ruleEnabled[type] };
        if (variant !== undefined) m.variant = variant;
        return m;
      });
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/game-config`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pointValueSchedule, lockState, modifiers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; reason?: string };
        throw new Error(body.reason ?? body.code ?? `http_${res.status}`);
      }
      return (await res.json()) as GameConfigResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-config', eventId] }),
  });

  if (query.isPending) {
    return (
      <PageShell title="Rules & Games">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Rules & Games">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load the game config." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const isSeeded = query.data!.config !== null;

  return (
    <PageShell title="Rules & Games">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />

      <Card data-testid="preset-card" style={{ marginBottom: 16 }}>
        <strong>Standard Guyan</strong>
        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          The classic 2v2: low ball, skin, team total, plus net-skins. Every foursome
          inherits this with zero extra taps. Pick the stake below.
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Point value</legend>
          <label style={{ display: 'block', minHeight: 44, marginBottom: 4 }} data-testid="pv-mode-flat">
            <input type="radio" name="pv-mode" checked={mode === 'flat'} onChange={() => setMode('flat')} />{' '}
            Single value (all 18 holes)
          </label>
          {mode === 'flat' ? (
            <FormField label="Dollars per point">
              <input
                type="number"
                min={1}
                step={1}
                data-testid="pv-flat-dollars"
                value={flatDollars}
                onChange={(e) => setFlatDollars(Number(e.target.value))}
                style={{ minHeight: 44 }}
              />
            </FormField>
          ) : null}

          <label style={{ display: 'block', minHeight: 44, margin: '8px 0 4px' }} data-testid="pv-mode-front-back">
            <input type="radio" name="pv-mode" checked={mode === 'front-back'} onChange={() => setMode('front-back')} />{' '}
            Front / back split
          </label>
          {mode === 'front-back' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <FormField label="Front $/pt">
                <input
                  type="number"
                  min={1}
                  step={1}
                  data-testid="pv-front-dollars"
                  value={frontDollars}
                  onChange={(e) => setFrontDollars(Number(e.target.value))}
                  style={{ minHeight: 44 }}
                />
              </FormField>
              <FormField label="Back $/pt">
                <input
                  type="number"
                  min={1}
                  step={1}
                  data-testid="pv-back-dollars"
                  value={backDollars}
                  onChange={(e) => setBackDollars(Number(e.target.value))}
                  style={{ minHeight: 44 }}
                />
              </FormField>
            </div>
          ) : null}
        </fieldset>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Rules</legend>
          <div style={{ marginBottom: 12 }}>
            <RulesSummary
              modifiers={RULE_TYPES.map(({ type }) => ({ type, enabled: ruleEnabled[type] }))}
            />
          </div>
          {RULE_TYPES.map(({ type, label }) => {
            const on = ruleEnabled[type];
            return (
              <div
                key={type}
                data-testid={`rule-row-${type}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}
              >
                <span style={{ fontWeight: 600 }}>{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  data-testid={`rule-toggle-${type}`}
                  aria-label={`${on ? 'Disable' : 'Enable'} ${label}`}
                  onClick={() => setRuleEnabled((prev) => ({ ...prev, [type]: !prev[type] }))}
                  style={{
                    minHeight: 44, minWidth: 68, padding: '0 14px', borderRadius: 'var(--radius-md)',
                    fontWeight: 700, fontSize: 'var(--font-sm)', cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--color-brand-primary)' : 'var(--color-border)'}`,
                    background: on ? 'var(--color-brand-primary)' : 'transparent',
                    color: on ? '#0a0a0a' : 'var(--color-text-muted)',
                  }}
                >
                  {on ? 'On' : 'Off'}
                </button>
              </div>
            );
          })}
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 8 }}>
            Net Skins is scored on net (gross basis = future).
          </div>
        </fieldset>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }} data-testid="lock-toggle">
          <input
            type="checkbox"
            checked={lockState === 'unlocked'}
            onChange={(e) => setLockState(e.target.checked ? 'unlocked' : 'locked')}
          />
          <span>
            <strong>Let foursomes change their game</strong>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
              {lockState === 'locked'
                ? 'Locked — every foursome plays the event default.'
                : 'Unlocked — foursomes may diverge (self-serve edits arrive later).'}
            </div>
          </span>
        </label>
      </Card>

      {save.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          Couldn&apos;t save ({save.error.message}).
        </p>
      ) : null}
      {save.isSuccess ? (
        <p role="status" style={{ color: 'var(--color-success, var(--color-brand-primary))' }}>
          Saved.
        </p>
      ) : null}

      <Button data-testid="save-game-config" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : isSeeded ? 'Save changes' : 'Set up Standard Guyan'}
      </Button>
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/game-config')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <GameConfigPage eventId={eventId} />;
}
